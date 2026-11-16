import { Test, TestingModule } from '@nestjs/testing';
import { DonationsService } from './donations.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Donation, DonationStatus } from './entities/donation.entity';
import { User, UserRole } from '../auth/entities/user.entity';
import { BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventsGateway } from '../events/events.gateway';
import { RedisService } from '../common/redis.service';

// 1. Create a SHARED mock for QueryBuilder
const mockQueryBuilder = {
  where: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  having: jest.fn().mockReturnThis(),
  setParameters: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([{ id: 'geo1', name: 'Nearby Food' }]),
};

const mockEntityManager = {
  findOne: jest.fn(),
  save: jest.fn(),
};

const mockDonationRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  manager: {
    transaction: jest.fn(async (cb: any) => cb(mockEntityManager)),
  },
  // 2. Return the SAME object every time
  createQueryBuilder: jest.fn(() => mockQueryBuilder),
};

const mockUserRepo = {
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn(),
};

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  clear: jest.fn(),
  reset: jest.fn(),
};

const mockEventsGateway = {
  emitDonationCreated: jest.fn(),
  emitDonationClaimed: jest.fn(),
  emitVolunteerAssigned: jest.fn(),
  emitNotification: jest.fn(),
};

const mockRedisService = {
  deleteKeysByPattern: jest.fn(),
  deleteKey: jest.fn(),
};

describe('DonationsService Unit Tests', () => {
  let service: DonationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DonationsService,
        { provide: getRepositoryToken(Donation), useValue: mockDonationRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: EventsGateway, useValue: mockEventsGateway },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<DonationsService>(DonationsService);
  });

  afterEach(() => jest.clearAllMocks());

  // --- TEST SUITE 1: FOOD SAFETY LOGIC ---
  describe('create (Food Safety)', () => {
    it('should block expired food', async () => {
      const pastDate = new Date(Date.now() - 10000).toISOString();
      const dto = {
        name: 'Old Milk',
        foodType: 'packaged',
        quantity: 1,
        expiryTime: pastDate,
        preparationTime: new Date().toISOString(),
      };
      await expect(service.create(dto as any, 'donor1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should enforce 2-hour rule for High Risk (Cooked) food', async () => {
      const oneHourFromNow = new Date(Date.now() + 3600 * 1000).toISOString();
      const dto = {
        name: 'Chicken Curry',
        foodType: 'cooked',
        quantity: 5,
        expiryTime: oneHourFromNow,
        preparationTime: new Date().toISOString(),
      };
      await expect(service.create(dto as any, 'donor1')).rejects.toThrow(
        /High-risk food/,
      );
    });

    it('should accept valid food', async () => {
      const validDate = new Date(Date.now() + 7200 * 1000).toISOString();
      const dto = {
        name: 'Bread',
        foodType: 'bakery',
        quantity: 10,
        expiryTime: validDate,
        preparationTime: new Date().toISOString(),
      };
      mockDonationRepo.create.mockReturnValue(dto);
      mockDonationRepo.save.mockResolvedValue({
        id: 'd1',
        ...dto,
        status: DonationStatus.AVAILABLE,
      });

      const result = await service.create(dto as any, 'donor1');
      expect(result.status).toBe(DonationStatus.AVAILABLE);
    });
  });

  // --- TEST SUITE 2: NGO CLAIMING & CAPACITY ---
  describe('claim (Capacity Logic)', () => {
    it('should fail if user is NOT an NGO', async () => {
      mockEntityManager.findOne
        .mockResolvedValueOnce({ id: 'd1', status: DonationStatus.AVAILABLE })
        .mockResolvedValueOnce({ id: 'u1', role: UserRole.DONOR });
      await expect(service.claim('d1', {} as any, 'u1')).rejects.toThrow(
        /Only NGOs/,
      );
    });

    it('should fail if NGO exceeds Daily Capacity', async () => {
      const heavyDonation = {
        id: 'd1',
        quantity: 50,
        status: DonationStatus.AVAILABLE,
      };
      const fullNgo = {
        id: 'u1',
        role: UserRole.NGO,
        isVerified: true,
        currentIntakeLoad: 80,
        dailyIntakeCapacity: 100,
      };
      mockEntityManager.findOne
        .mockResolvedValueOnce(heavyDonation)
        .mockResolvedValueOnce(fullNgo);
      await expect(service.claim('d1', {} as any, 'u1')).rejects.toThrow(
        /Claim exceeds daily intake capacity/,
      );
    });

    it('should succeed and lock donation if capacity is sufficient', async () => {
      const donation = {
        id: 'd1',
        quantity: 10,
        status: DonationStatus.AVAILABLE,
      };
      const ngo = {
        id: 'u1',
        role: UserRole.NGO,
        isVerified: true,
        currentIntakeLoad: 50,
        dailyIntakeCapacity: 100,
      };
      mockEntityManager.findOne
        .mockResolvedValueOnce(donation)
        .mockResolvedValueOnce(ngo);
      mockEntityManager.save.mockImplementation((entity) =>
        Promise.resolve(entity),
      );

      const result = await service.claim('d1', {} as any, 'u1');
      expect(result.status).toBe(DonationStatus.CLAIMED);
    });

    it('persists and emits an assigned volunteer after the claim transaction completes', async () => {
      const donation = {
        id: 'd1',
        name: 'Fresh meals',
        donorId: 'donor1',
        latitude: 12.3,
        longitude: 76.6,
        quantity: 10,
        status: DonationStatus.AVAILABLE,
      };
      const ngo = {
        id: 'ngo1',
        name: 'Food Bank',
        role: UserRole.NGO,
        isVerified: true,
        currentIntakeLoad: 0,
        dailyIntakeCapacity: null,
        badges: [],
      };
      mockEntityManager.findOne
        .mockResolvedValueOnce(donation)
        .mockResolvedValueOnce(ngo);
      mockEntityManager.save.mockImplementation((entity) =>
        Promise.resolve(entity),
      );
      mockUserRepo.find.mockResolvedValueOnce([
        { id: 'volunteer1', latitude: 12.31, longitude: 76.61 },
      ]);

      let transactionCompleted = false;
      mockDonationRepo.manager.transaction.mockImplementationOnce(
        async (callback: any) => {
          const result = await callback(mockEntityManager);
          transactionCompleted = true;
          return result;
        },
      );
      mockEventsGateway.emitVolunteerAssigned.mockImplementationOnce(() => {
        expect(transactionCompleted).toBe(true);
      });

      const result = await service.claim('d1', {} as any, 'ngo1');

      expect(result.volunteerId).toBe('volunteer1');
      expect(mockEntityManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd1', volunteerId: 'volunteer1' }),
      );
      expect(mockEventsGateway.emitVolunteerAssigned).toHaveBeenCalledWith(
        expect.objectContaining({
          volunteerId: 'volunteer1',
          donationId: 'd1',
        }),
      );
    });
  });

  // --- TEST SUITE 3: VOLUNTEER WORKFLOW ---
  describe('updateStatus (Volunteer Flow)', () => {
    it('should allow Volunteer to Pickup claimed food', async () => {
      const donation = {
        id: 'd1',
        status: DonationStatus.CLAIMED,
        claimedById: 'ngo1',
        donorId: 'donor1',
        volunteerId: 'vol1',
      };
      const volunteer = { id: 'vol1', role: UserRole.VOLUNTEER };
      mockEntityManager.findOne
        .mockResolvedValueOnce(donation)
        .mockResolvedValueOnce(volunteer);
      mockEntityManager.save.mockResolvedValue({
        ...donation,
        status: DonationStatus.PICKED_UP,
      });

      const result = await service.updateStatus(
        'd1',
        DonationStatus.PICKED_UP,
        'vol1',
      );
      expect(result.status).toBe(DonationStatus.PICKED_UP);
    });

    it('should fail if unauthorized user tries to update', async () => {
      const donation = {
        id: 'd1',
        status: DonationStatus.CLAIMED,
        claimedById: 'ngo1',
      };
      const rando = { id: 'rando1', role: UserRole.DONOR };
      mockEntityManager.findOne
        .mockResolvedValueOnce(donation)
        .mockResolvedValueOnce(rando);
      await expect(
        service.updateStatus('d1', DonationStatus.PICKED_UP, 'rando1'),
      ).rejects.toThrow(/not authorized/);
    });

    it('should reject a volunteer who is not assigned to the donation', async () => {
      const donation = {
        id: 'd1',
        status: DonationStatus.CLAIMED,
        claimedById: 'ngo1',
        volunteerId: 'vol2',
      };
      const volunteer = { id: 'vol1', role: UserRole.VOLUNTEER };
      mockEntityManager.findOne
        .mockResolvedValueOnce(donation)
        .mockResolvedValueOnce(volunteer);

      await expect(
        service.updateStatus('d1', DonationStatus.PICKED_UP, 'vol1'),
      ).rejects.toThrow(/not authorized/);
    });
  });

  // --- TEST SUITE 4: GEOSPATIAL DISCOVERY ---
  describe('findAll (Discovery)', () => {
    it('should use QueryBuilder (Haversine) when lat/lon are provided', async () => {
      // First find call is the on-the-fly expiry sweep, return empty
      mockDonationRepo.find.mockResolvedValueOnce([]);

      await service.findAll(12.97, 77.59, 5);

      // 3. 👇 Check against the SHARED mock
      expect(mockDonationRepo.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalled();
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        expect.stringContaining('6371 * acos'),
        'distance',
      );
    });

    describe('findMine (Scoped visibility)', () => {
      it('returns only the donor’s donations and claimant contact details', async () => {
        const donation = {
          id: 'd1',
          donorId: 'donor1',
          claimedById: 'ngo1',
          status: DonationStatus.CLAIMED,
        };
        mockUserRepo.findOne.mockResolvedValueOnce({
          id: 'donor1',
          role: UserRole.DONOR,
        });
        mockDonationRepo.find.mockResolvedValueOnce([donation]);
        mockUserRepo.find.mockResolvedValueOnce([
          {
            id: 'ngo1',
            name: 'Organization User',
            organizationName: 'Community Kitchen',
            phone: '555-0100',
            address: 'Mysore',
          },
        ]);

        const result = await service.findMine('donor1');

        expect(mockDonationRepo.find).toHaveBeenCalledWith(
          expect.objectContaining({ where: { donorId: 'donor1' } }),
        );
        expect(result[0].contact).toEqual({
          name: 'Community Kitchen',
          phone: '555-0100',
          address: 'Mysore',
        });
      });
    });

    it('should use standard find() when no location is provided', async () => {
      // First find call is the on-the-fly expiry sweep, return empty
      mockDonationRepo.find.mockResolvedValueOnce([]);

      await service.findAll();
      // find is called twice: once for expiry sweep, once for the actual query
      expect(mockDonationRepo.find).toHaveBeenCalledTimes(2);
      expect(mockDonationRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // --- TEST SUITE 5: CRON JOB (Auto-Expire) ---
  describe('handleExpiredDonations (Cron Job)', () => {
    it('should expire AVAILABLE/CLAIMED donations past their expiryTime', async () => {
      const expiredDonations = [
        {
          id: 'd1',
          status: DonationStatus.AVAILABLE,
          expiryTime: new Date(Date.now() - 3600000),
        },
        {
          id: 'd2',
          status: DonationStatus.CLAIMED,
          expiryTime: new Date(Date.now() - 7200000),
        },
      ];

      mockDonationRepo.find.mockResolvedValueOnce(expiredDonations);
      mockDonationRepo.save.mockResolvedValueOnce(expiredDonations);

      await service.handleExpiredDonations();

      // Both donations should be marked as EXPIRED
      expect(expiredDonations[0].status).toBe(DonationStatus.EXPIRED);
      expect(expiredDonations[1].status).toBe(DonationStatus.EXPIRED);
      expect(mockDonationRepo.save).toHaveBeenCalledWith(expiredDonations);
    });

    it('should do nothing when no donations are expired', async () => {
      mockDonationRepo.find.mockResolvedValueOnce([]);

      await service.handleExpiredDonations();

      // save should NOT be called since there's nothing to expire
      expect(mockDonationRepo.save).not.toHaveBeenCalled();
    });
  });

  // --- TEST SUITE 6: CLAIM REJECTS EXPIRED FOOD ---
  describe('claim (Expiry Guard)', () => {
    it('should reject claiming a donation whose expiryTime has passed', async () => {
      const expiredDonation = {
        id: 'd1',
        status: DonationStatus.AVAILABLE,
        expiryTime: new Date(Date.now() - 60000), // expired 1 minute ago
      };
      const ngo = { id: 'u1', role: UserRole.NGO };

      mockEntityManager.findOne
        .mockResolvedValueOnce(expiredDonation)
        .mockResolvedValueOnce(ngo);
      mockEntityManager.save.mockResolvedValue(expiredDonation);

      await expect(service.claim('d1', {} as any, 'u1')).rejects.toThrow(
        /expired/,
      );
      // Donation should be marked EXPIRED as a side effect
      expect(expiredDonation.status).toBe(DonationStatus.EXPIRED);
    });
  });
});
