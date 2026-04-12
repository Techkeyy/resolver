import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import BetPage from './pages/BetPage'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
	<BrowserRouter>
		<Routes>
			<Route path="/" element={<Home />} />
			<Route path="/bet/:invite_code" element={<BetPage />} />
		</Routes>
	</BrowserRouter>
)
