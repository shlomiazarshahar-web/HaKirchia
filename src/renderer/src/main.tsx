import { createRoot } from 'react-dom/client'
import './fonts'
import './styles.css'
import App from './App'
import { runPrint } from './print'

// The same page also serves the hidden print window of the PDF export (feature 16)
if (location.hash === '#print') void runPrint()
else createRoot(document.getElementById('root')!).render(<App />)
