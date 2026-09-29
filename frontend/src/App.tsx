import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AppRoutes } from './components/AppRoutes'

const router = createBrowserRouter([{ path: '*', element: <AppRoutes /> }])

function App() {
  return <RouterProvider router={router} />
}

export default App
