import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { createDonation, type FoodType } from '../../services/api'
import { AlertTriangle, Clock, CheckCircle2, Locate, MapPin, Upload, X } from 'lucide-react'

// Fix for default marker
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

interface LatLng {
    lat: number
    lng: number
}

function LocationMarker({ position, setPosition }: { position: LatLng | null; setPosition: (pos: LatLng) => void }) {
    useMapEvents({
        click(e) {
            setPosition({ lat: e.latlng.lat, lng: e.latlng.lng })
        },
    })

    return position ? <Marker position={[position.lat, position.lng]} /> : null
}

function RecenterMap({ position }: { position: LatLng | null }) {
    const map = useMap()

    useEffect(() => {
        if (position) map.flyTo([position.lat, position.lng], 15, { duration: 0.6 })
    }, [map, position])

    return null
}

export default function AddFood() {
    const navigate = useNavigate()
    const { t } = useTranslation()
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [location, setLocation] = useState<LatLng | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [images, setImages] = useState<File[]>([])
    const [isLocating, setIsLocating] = useState(false)

    const [formData, setFormData] = useState({
        foodType: '' as FoodType | '',
        foodName: '',
        quantity: '',
        unit: 'kg',
        description: '',
        keptCovered: false,
        containerClean: false,
        preparationTime: '',
    })

    const user = JSON.parse(localStorage.getItem('user') || '{}')
    const donorId = String(user?.id ?? '').trim()
    const donorName = String(user?.organizationName ?? user?.name ?? '').trim()
    const imagePreviews = useMemo(
        () => images.map((file) => ({ file, url: URL.createObjectURL(file) })),
        [images],
    )

    useEffect(() => () => {
        imagePreviews.forEach(({ url }) => URL.revokeObjectURL(url))
    }, [imagePreviews])

    const foodTypes = [
        { id: 'cooked', label: t('cooked'), expiryHours: 4, icon: '🍛' },
        { id: 'raw', label: t('raw'), expiryHours: 24, icon: '🥬' },
        { id: 'packaged', label: t('packaged'), expiryHours: 720, icon: '📦' },
        { id: 'fruits', label: t('fruits'), expiryHours: 48, icon: '🍎' },
        { id: 'bakery', label: t('bakery'), expiryHours: 24, icon: '🥖' },
        { id: 'dairy', label: t('dairy'), expiryHours: 48, icon: '🥛' },
    ]

    const units = [
        { value: 'kg', label: t('unitKg') },
        { value: 'g', label: t('unitG') },
        { value: 'pieces', label: t('unitPieces') },
        { value: 'servings', label: t('unitServings') },
        { value: 'boxes', label: t('unitBoxes') },
        { value: 'liters', label: t('unitLiters') },
    ]

    const selectedFoodType = foodTypes.find(f => f.id === formData.foodType)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value, type } = e.target
        const checked = (e.target as HTMLInputElement).checked
        setFormData({
            ...formData,
            [name]: type === 'checkbox' ? checked : value,
        })
        setError(null)
    }

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedImages = Array.from(e.target.files || [])
        e.target.value = ''

        if (selectedImages.length > 5) {
            setError(t('imageLimitError'))
            return
        }

        if (selectedImages.some((file) => file.size > 5 * 1024 * 1024)) {
            setError(t('imageSizeError'))
            return
        }

        if (selectedImages.some((file) => !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type))) {
            setError(t('imageTypeError'))
            return
        }

        setImages(selectedImages)
        setError(null)
    }

    const handleUseMyLocation = () => {
        if (!navigator.geolocation) {
            setError(t('geolocationUnsupported'))
            return
        }

        setIsLocating(true)
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                setLocation({ lat: coords.latitude, lng: coords.longitude })
                setError(null)
                setIsLocating(false)
            },
            () => {
                setError(t('geolocationFailed'))
                setIsLocating(false)
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
        )
    }

    const getRemainingTime = () => {
        if (!formData.preparationTime || !selectedFoodType) return null

        const prepTime = new Date(formData.preparationTime)
        const now = new Date()

        // Check if preparation time is in the future
        if (prepTime > now) {
            return { expired: false, futureTime: true, hours: 0, minutes: 0 }
        }

        const expiryTime = new Date(prepTime.getTime() + selectedFoodType.expiryHours * 60 * 60 * 1000)
        const remaining = expiryTime.getTime() - now.getTime()

        if (remaining <= 0) return { expired: true, futureTime: false, hours: 0, minutes: 0 }

        const hours = Math.floor(remaining / (1000 * 60 * 60))
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))

        return { expired: false, futureTime: false, hours, minutes }
    }

    const timeStatus = getRemainingTime()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        // Check if time is in the future
        if (timeStatus?.futureTime) {
            setError(t('prepTimeError'))
            return
        }

        // Validate time safety
        if (timeStatus?.expired) {
            setError(t('exceededSafeWindow', { foodType: formData.foodType, hours: selectedFoodType?.expiryHours }))
            return
        }

        if (!location) {
            setError(t('selectPickupLocation'))
            return
        }

        if (!donorId || !donorName) {
            setError(t('missingDonorInfo'))
            return
        }

        setIsSubmitting(true)

        try {
            // Calculate expiry time based on preparation time and food type
            const prepTime = new Date(formData.preparationTime);
            const expiryTime = new Date(prepTime.getTime() + (selectedFoodType!.expiryHours * 60 * 60 * 1000));

            // Correctly constructing the payload and passing images
            const payload = {
                name: formData.foodName,
                foodType: formData.foodType as FoodType,
                quantity: formData.quantity,
                unit: formData.unit,
                description: formData.description,
                donorId,
                donorName,
                donorTrustScore: user.trustScore || 0,
                location,
                hygiene: {
                    keptCovered: formData.keptCovered,
                    containerClean: formData.containerClean,
                },
                preparationTime: new Date(formData.preparationTime),
                expiryTime: expiryTime,
            };

            // Call API with payload and images
            await createDonation(payload, images);

            navigate('/dashboard')
        } catch (err: unknown) {
            console.error(err);
            const errorObj = err as { response?: { data?: { message?: string } }, message?: string }
            setError(errorObj.response?.data?.message || errorObj.message || t('failedCreateDonationGeneric'))
        } finally {
            setIsSubmitting(false)
        }
    }

    const hygieneComplete = formData.keptCovered && formData.containerClean
    const isFormValid =
        hygieneComplete &&
        formData.foodType &&
        formData.foodName.trim() &&
        Number(formData.quantity) > 0 &&
        formData.preparationTime &&
        location &&
        donorId &&
        donorName &&
        timeStatus &&
        !timeStatus.expired &&
        !timeStatus.futureTime
    const incompleteRequirements = [
        !formData.foodType && t('foodType'),
        !formData.foodName.trim() && t('foodName'),
        Number(formData.quantity) <= 0 && t('quantity'),
        !formData.preparationTime && t('whenPrepared'),
        !location && t('pickupLocationLabel'),
        !hygieneComplete && t('hygieneChecklist'),
    ].filter(Boolean)

    return (
        <div className="max-w-2xl mx-auto">
            <header className="mb-8 overflow-hidden rounded-3xl border border-emerald-200/70 bg-gradient-to-br from-white via-emerald-50 to-teal-100 p-6 shadow-xl shadow-emerald-950/5 dark:border-emerald-900/50 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/60 sm:p-8">
                <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/25">
                        <MapPin className="h-6 w-6" />
                    </div>
                    <div>
                        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">{t('foodRescueListing')}</p>
                        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">{t('addFoodDonation')}</h1>
                        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">{t('shareSurplusFoodNeed')}</p>
                    </div>
                </div>
                <div className="mt-6 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/80 dark:bg-slate-800">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
                            style={{ width: `${((6 - incompleteRequirements.length) / 6) * 100}%` }}
                        />
                    </div>
                    <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                        {t('requirementsComplete', { complete: 6 - incompleteRequirements.length, total: 6 })}
                    </span>
                </div>
            </header>

            {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-400">{error}</p>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Food Type */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <label className="block text-sm text-gray-500 dark:text-slate-400 mb-3">{t('foodType')}</label>
                    <div className="grid grid-cols-3 gap-2">
                        {foodTypes.map((type) => (
                            <button
                                key={type.id}
                                type="button"
                                onClick={() => setFormData({ ...formData, foodType: type.id as FoodType })}
                                className={`py-3 rounded-lg text-sm font-medium transition-all ${formData.foodType === type.id
                                        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                                        : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-750'
                                    }`}
                            >
                                <div className="text-lg mb-1">{type.icon}</div>
                                {type.label}
                            </button>
                        ))}
                    </div>
                    {selectedFoodType && (
                        <div className="mt-3 p-3 bg-gray-100 dark:bg-slate-800 rounded-lg">
                            <p className="text-xs text-gray-500 dark:text-slate-400">
                                <Clock className="w-3 h-3 inline mr-1" />
                                {t('safeConsumptionWindow', { hours: selectedFoodType.expiryHours })}
                            </p>
                        </div>
                    )}
                </div>

                {/* Preparation Time */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <label className="block text-sm text-gray-500 dark:text-slate-400 mb-2">{t('whenPrepared')}</label>
                    <input
                        type="datetime-local"
                        name="preparationTime"
                        value={formData.preparationTime}
                        onChange={handleChange}
                        required
                        className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-lg px-4 py-3 text-gray-900 dark:text-white focus:border-emerald-500 focus:outline-none"
                    />
                    {timeStatus?.futureTime && formData.preparationTime && (
                        <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-400" />
                            <p className="text-sm text-amber-400">
                                {t('prepTimeError')}
                            </p>
                        </div>
                    )}
                    {timeStatus && !timeStatus.expired && !timeStatus.futureTime && formData.preparationTime && (
                        <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <p className="text-sm text-emerald-400">
                                {t('safeFor')} <span className="font-semibold">{timeStatus.hours}h {timeStatus.minutes}m</span> {t('more')}
                            </p>
                        </div>
                    )}
                    {timeStatus?.expired && (
                        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-400" />
                            <p className="text-sm text-red-400">
                                {t('exceededSafeLimits')}
                            </p>
                        </div>
                    )}
                </div>

                {/* Details */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                    <div>
                        <label className="block text-sm text-gray-500 dark:text-slate-400 mb-2">{t('foodName')}</label>
                        <input
                            type="text"
                            name="foodName"
                            value={formData.foodName}
                            onChange={handleChange}
                            placeholder={t('foodNamePlaceholder')}
                            required
                            className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-lg px-4 py-3 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-500 dark:text-slate-400 mb-2">{t('quantity')}</label>
                            <input
                                type="number"
                                name="quantity"
                                value={formData.quantity}
                                onChange={handleChange}
                                placeholder="10"
                                min="0.1"
                                step="0.1"
                                required
                                className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-lg px-4 py-3 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-500 dark:text-slate-400 mb-2">{t('unit')}</label>
                            <select
                                name="unit"
                                value={formData.unit}
                                onChange={handleChange}
                                className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-lg px-4 py-3 text-gray-900 dark:text-white focus:border-emerald-500 focus:outline-none"
                            >
                                {units.map((u) => (
                                    <option key={u.value} value={u.value}>{u.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-500 dark:text-slate-400 mb-2">{t('descriptionOptional')}</label>
                        <textarea
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            placeholder={t('descriptionPlaceholder')}
                            rows={3}
                            className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-lg px-4 py-3 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-600 focus:border-emerald-500 focus:outline-none resize-none"
                        />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm text-gray-500 dark:text-slate-400">{t('foodImages')}</label>
                        <div className="relative">
                            <input
                                type="file"
                                multiple
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                onChange={handleImageChange}
                                aria-label={t('foodImages')}
                                className="block w-full text-sm text-gray-500 dark:text-slate-400
                                file:mr-4 file:py-2 file:px-4
                                file:rounded-full file:border-0
                                file:text-sm file:font-semibold
                                file:bg-emerald-500 file:text-white
                                hover:file:bg-emerald-600
                                cursor-pointer bg-gray-50 dark:bg-slate-950 rounded-lg border border-gray-200 dark:border-slate-800"
                            />
                            <div className="absolute right-3 top-2 pointer-events-none">
                                <Upload className="w-5 h-5 text-gray-500 dark:text-slate-500" />
                            </div>
                        </div>
                        <p className="mt-2 text-xs text-gray-500 dark:text-slate-500">{t('imageUploadLimits')}</p>
                        {imagePreviews.length > 0 && (
                            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {imagePreviews.map(({ file, url }, index) => (
                                    <div key={`${file.name}-${file.lastModified}`} className="group relative overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700">
                                        <img src={url} alt={file.name} className="h-28 w-full object-cover" />
                                        <button
                                            type="button"
                                            aria-label={`${t('removeImage')} ${file.name}`}
                                            onClick={() => setImages((current) => current.filter((_, imageIndex) => imageIndex !== index))}
                                            className="absolute right-2 top-2 rounded-full bg-slate-950/75 p-1.5 text-white opacity-100 transition hover:bg-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                        <span className="absolute inset-x-0 bottom-0 truncate bg-slate-950/65 px-2 py-1 text-xs text-white">{file.name}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Location Picker */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                        <label className="text-sm text-gray-500 dark:text-slate-400">{t('pickupLocationLabel')}</label>
                        <button
                            type="button"
                            onClick={handleUseMyLocation}
                            disabled={isLocating}
                            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-300"
                        >
                            <Locate className={`h-4 w-4 ${isLocating ? 'animate-pulse' : ''}`} />
                            {isLocating ? t('findingLocation') : t('useMyLocation')}
                        </button>
                    </div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-xs text-gray-500 dark:text-slate-500">{t('clickMapToSet')}</p>
                        {location && (
                            <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                {t('locationSelected')}
                            </span>
                        )}
                    </div>
                    <div className="rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700" style={{ height: '250px' }}>
                        <MapContainer
                            center={[12.2958, 76.6394]}
                            zoom={12}
                            style={{ height: '100%', width: '100%' }}
                        >
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                            <LocationMarker position={location} setPosition={setLocation} />
                            <RecenterMap position={location} />
                        </MapContainer>
                    </div>
                    {location && (
                        <p className="text-xs text-gray-500 dark:text-slate-500 mt-2">
                            📍 {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                        </p>
                    )}
                </div>

                {/* Hygiene Checklist */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                        <label className="text-sm text-gray-500 dark:text-slate-400">{t('hygieneChecklist')}</label>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${hygieneComplete ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                            }`}>
                            {hygieneComplete ? t('hygieneComplete') : t('required')}
                        </span>
                    </div>

                    <div className="space-y-2">
                        <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${formData.keptCovered
                                ? 'border-emerald-500 bg-emerald-500/5'
                                : 'border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-gray-300 dark:border-slate-700'
                            }`}>
                            <input
                                type="checkbox"
                                name="keptCovered"
                                checked={formData.keptCovered}
                                onChange={handleChange}
                                className="w-4 h-4 rounded border-gray-400 dark:border-slate-600 text-emerald-500 focus:ring-emerald-500 bg-white dark:bg-slate-900"
                            />
                            <span className="text-sm text-gray-700 dark:text-slate-300">{t('keptCoveredAlways')}</span>
                        </label>

                        <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${formData.containerClean
                                ? 'border-emerald-500 bg-emerald-500/5'
                                : 'border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-gray-300 dark:border-slate-700'
                            }`}>
                            <input
                                type="checkbox"
                                name="containerClean"
                                checked={formData.containerClean}
                                onChange={handleChange}
                                className="w-4 h-4 rounded border-gray-400 dark:border-slate-600 text-emerald-500 focus:ring-emerald-500 bg-white dark:bg-slate-900"
                            />
                            <span className="text-sm text-gray-700 dark:text-slate-300">{t('cleanFoodSafe')}</span>
                        </label>
                    </div>

                    <div className="mt-4 p-3 bg-gray-100 dark:bg-slate-800 rounded-lg">
                        <p className="text-xs text-gray-500 dark:text-slate-400">
                            ℹ️ {t('hygieneNote')}
                        </p>
                    </div>
                </div>

                {/* Submit */}
                <button
                    type="submit"
                    disabled={isSubmitting || !isFormValid}
                    className={`w-full rounded-xl py-4 font-semibold transition-all ${isSubmitting || !isFormValid
                        ? 'cursor-not-allowed bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-500'
                        : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 hover:-translate-y-0.5 hover:from-emerald-400 hover:to-teal-400 hover:shadow-xl'
                        }`}
                >
                    {isSubmitting ? t('creatingDonation') : t('publishDonation')}
                </button>
                {incompleteRequirements.length > 0 && (
                    <p aria-live="polite" className="text-center text-xs text-gray-500 dark:text-slate-400">
                        {t('completeBeforePublishing')}: {incompleteRequirements.join(' · ')}
                    </p>
                )}
            </form>
        </div>
    )
}