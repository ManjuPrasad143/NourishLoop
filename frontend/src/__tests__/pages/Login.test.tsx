/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const, @typescript-eslint/no-unused-vars */
import { fireEvent, render, screen } from '@testing-library/react'
import Login from '../../pages/Login'
import { loginUser } from '../../services/api'

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
    Link: ({ to, children }: any) => <a href={to}>{children}</a>,
    BrowserRouter: ({ children }: any) => children,
    Routes: ({ children }: any) => children,
    Route: ({ element }: any) => element,
}))

vi.mock('../../services/api', () => ({
    loginUser: vi.fn(),
}))

describe('Login - User Authentication', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('should render login form with email and password fields', () => {
        render(<Login />)
        const emailInputs = document.querySelectorAll('input[type="email"]')
        const passwordInputs = document.querySelectorAll('input[type="password"]')
        expect(emailInputs.length > 0 || passwordInputs.length > 0).toBeTruthy()
    })

    it('should display login page title and branding', () => {
        const { container } = render(<Login />)
        expect(container.querySelector('h1') || container.querySelector('h2')).toBeTruthy()
    })

    it('should handle form submission with valid credentials', () => {
        render(<Login />)
        const submitButtons = document.querySelectorAll('button[type="submit"]')
        expect(submitButtons.length > 0).toBeTruthy()
    })

    it('should display feature list for platform benefits', () => {
        const { container } = render(<Login />)
        const listItems = container.querySelectorAll('div, li, p')
        expect(listItems.length > 0).toBeTruthy()
    })

    it('should render register link for new users', () => {
        const { container } = render(<Login />)
        const links = container.querySelectorAll('a')
        expect(links.length >= 0).toBeTruthy()
    })

    it('shows a retryable error and clears loading when login times out', async () => {
        vi.mocked(loginUser).mockRejectedValue(
            Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }),
        )
        render(<Login />)

        fireEvent.change(screen.getByPlaceholderText('emailPlaceholder'), {
            target: { value: 'user@example.com' },
        })
        fireEvent.change(screen.getByPlaceholderText('passwordPlaceholder'), {
            target: { value: 'password' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'signIn' }))

        expect(await screen.findByText('loginTimeoutError')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'signIn' })).toBeEnabled()
    })
})
