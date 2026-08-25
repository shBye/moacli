import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { AppMotionProvider } from './motion/AppMotionProvider'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppMotionProvider>
      <App />
    </AppMotionProvider>
  </React.StrictMode>,
)
