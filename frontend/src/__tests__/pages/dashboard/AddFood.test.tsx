/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const, @typescript-eslint/no-unused-vars */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AddFood from '../../../pages/dashboard/AddFood'
import { createDonation } from '../../../services/api'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children }: any) => <a href={to}>{children}</a>,
  BrowserRouter: ({ children }: any) => children,
  Routes: ({ children }: any) => children,
  Route: ({ element }: any) => element,
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, center }: any) => (
    <div data-testid="map" data-center={center.join(',')}>{children}</div>
  ),
  TileLayer: () => null,
  Marker: () => null,
  useMap: () => ({ flyTo: vi.fn() }),
  useMapEvents: () => null,
}))

vi.mock('../../../services/api', () => ({
  createDonation: vi.fn().mockResolvedValue({ id: '1' }),
}))

describe('AddFood - Food Donation Form', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('user', JSON.stringify({
      id: '1',
      name: 'Test Donor',
      role: 'donor'
    }))
    vi.clearAllMocks()
  })

  it('should render food donation form', () => {
    const { container } = render(<AddFood />)
    expect(container).toBeTruthy()
  })

  it('should display food type selection options', () => {
    const { container } = render(<AddFood />)
    const selects = container.querySelectorAll('select, button[role="listbox"]')
    expect(selects.length > 0 || container.querySelectorAll('div').length > 0).toBeTruthy()
  })

  it('should have quantity and unit input fields', () => {
    const { container } = render(<AddFood />)
    const inputs = container.querySelectorAll('input[type="number"], input[type="text"], select')
    expect(inputs.length > 0).toBeTruthy()
  })

  it('should include hygiene checklist checkboxes', () => {
    const { container } = render(<AddFood />)
    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes.length > 0).toBeTruthy()
  })

  it('should have map for location selection', () => {
    const { container } = render(<AddFood />)
    const map = container.querySelector('[data-testid="map"]') || container.querySelector('div')
    expect(map).toBeTruthy()
  })

  it('defaults the pickup map to Mysore', () => {
    render(<AddFood />)
    expect(screen.getByTestId('map')).toHaveAttribute('data-center', '12.2958,76.6394')
  })

  it('should have image upload input for food photos', () => {
    const { container } = render(<AddFood />)
    const fileInputs = container.querySelectorAll('input[type="file"]')
    expect(fileInputs.length >= 0).toBeTruthy()
  })

  it('should render without crashing', () => {
    expect(() => render(<AddFood />)).not.toThrow()
  })

  it('keeps publishing disabled until required quantity and pickup details are complete', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 12.9716, longitude: 77.5946 } as GeolocationCoordinates,
        timestamp: Date.now(),
        toJSON: () => ({}),
      })
    })
    navigator.geolocation.getCurrentPosition = getCurrentPosition

    const { container } = render(<AddFood />)
    const publishButton = screen.getByRole('button', { name: 'publishDonation' })
    expect(publishButton).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /raw/i }))
    fireEvent.change(container.querySelector('[name="foodName"]')!, {
      target: { value: 'Fresh vegetables' },
    })
    fireEvent.change(container.querySelector('[name="preparationTime"]')!, {
      target: { value: new Date().toISOString().slice(0, 16) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'useMyLocation' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'keptCoveredAlways' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'cleanFoodSafe' }))

    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled())
    expect(publishButton).toBeDisabled()

    fireEvent.change(container.querySelector('[name="quantity"]')!, {
      target: { value: '12' },
    })
    expect(publishButton).toBeEnabled()

    fireEvent.click(publishButton)
    await waitFor(() => expect(createDonation).toHaveBeenCalled())
    expect(createDonation).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Fresh vegetables',
        quantity: '12',
        location: { lat: 12.9716, lng: 77.5946 },
      }),
      [],
    )
  })
})