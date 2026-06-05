import { useAuth } from './auth'
import Dashboard from './Dashboard'
import LoginPage from './LoginPage'

export default function App() {
  const user = useAuth(s => s.user)
  return user ? <Dashboard /> : <LoginPage />
}
