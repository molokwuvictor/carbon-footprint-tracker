require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

// Proxy endpoint for OpenWeather API
app.get('/api/weather', async (req, res) => {
    try {
        const { lat, lon } = req.query;
        const response = await fetch(
            `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`
        );
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Weather API Error:', error);
        res.status(500).json({ error: 'Failed to fetch weather data' });
    }
});

// Proxy endpoint for Electricity Map API
app.get('/api/carbon', async (req, res) => {
    try {
        const { lat, lon } = req.query;
        const response = await fetch(
            `https://api.electricitymap.org/v3/carbon-intensity/latest?lat=${lat}&lon=${lon}`,
            {
                headers: {
                    'auth-token': process.env.ELECTRICITYMAP_API_KEY
                }
            }
        );
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Carbon API Error:', error);
        res.status(500).json({ error: 'Failed to fetch carbon data' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
