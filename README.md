# Carbon Footprint Tracker

A web application that estimates carbon footprint based on your location using weather data and electricity carbon intensity information.

## Features

- Real-time geolocation using browser's built-in capabilities
- Interactive 2D world map showing user location
- Weather data from OpenWeather API
- Carbon intensity data from Electricity Map API
- Fallback values when APIs are unavailable
- Modern, responsive design

## Setup

1. Get API keys:
   - Sign up for a free API key at [OpenWeather](https://openweathermap.org/api)
   - Sign up for an API key at [Electricity Map](https://www.electricitymap.org/map)

2. Configure API keys:
   - Open `config.js`
   - Replace `YOUR_OPENWEATHER_API_KEY` with your OpenWeather API key
   - Replace `YOUR_ELECTRICITYMAP_API_KEY` with your Electricity Map API key

3. Run the application:
   - Open `index.html` in a modern web browser
   - Allow location access when prompted

## Technologies Used

- HTML5 Geolocation API
- Leaflet.js for map visualization
- OpenWeather API for weather data
- Electricity Map API for carbon intensity data
- Modern CSS with responsive design

## Note

The application includes fallback values when APIs are unavailable or not responding. These values are approximations and should not be used for critical decisions.
