// Initialize ArcGIS map and view
let view;
let map;
let userGraphic;

// Load ArcGIS modules
require([
    "esri/Map",
    "esri/views/MapView",
    "esri/Graphic",
    "esri/symbols/SimpleMarkerSymbol",
    "esri/geometry/Point"
], function(Map, MapView, Graphic, SimpleMarkerSymbol, Point) {
    // Create the map
    map = new Map({
        basemap: "streets-navigation-vector"
    });

    // Create the view
    view = new MapView({
        container: "map",
        map: map,
        center: [0, 0],
        zoom: 2
    });

    // Create a symbol for the user location
    const userSymbol = new SimpleMarkerSymbol({
        color: [0, 119, 255],
        outline: {
            color: [255, 255, 255],
            width: 2
        },
        size: 12
    });

    // Initialize user location graphic
    userGraphic = new Graphic({
        symbol: userSymbol
    });
});

// Fallback values when APIs fail
const FALLBACK_VALUES = {
    temperature: 20,
    humidity: 50,
    carbonIntensity: 300 // gCO2eq/kWh (global average approximation)
};

// DOM elements
const getLocationButton = document.getElementById('getLocation');
const locationInfo = document.getElementById('locationInfo');
const weatherData = document.getElementById('weatherData').querySelector('.data-content');
const carbonData = document.getElementById('carbonData').querySelector('.data-content');

// Get user's location
getLocationButton.addEventListener('click', () => {
    if (navigator.geolocation) {
        getLocationButton.disabled = true;
        getLocationButton.textContent = 'Getting location...';
        
        navigator.geolocation.getCurrentPosition(
            handleSuccess,
            handleError,
            { enableHighAccuracy: true }
        );
    } else {
        locationInfo.textContent = 'Geolocation is not supported by your browser';
        locationInfo.style.display = 'block';
    }
});

// Handle successful location retrieval
async function handleSuccess(position) {
    const { latitude, longitude } = position.coords;
    
    // Update map with ArcGIS API
    require(["esri/geometry/Point"], function(Point) {
        // Create point geometry
        const point = new Point({
            longitude: longitude,
            latitude: latitude
        });
        
        // Update user marker position
        if (userGraphic) {
            userGraphic.geometry = point;
            
            // Add graphic to the view if it's not already added
            if (!view.graphics.includes(userGraphic)) {
                view.graphics.add(userGraphic);
            }
        }
        
        // Center the view on the user's location
        view.goTo({
            target: point,
            zoom: 10
        });
    });
    
    // Display location info
    locationInfo.innerHTML = `📍 Location: ${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`;
    locationInfo.style.display = 'block';
    
    // Get weather and carbon data
    try {
        await Promise.all([
            fetchWeatherData(latitude, longitude),
            fetchCarbonData(latitude, longitude)
        ]);
    } catch (error) {
        console.error('Error fetching data:', error);
        useFallbackValues();
    }
    
    getLocationButton.disabled = false;
    getLocationButton.textContent = 'Update My Location';
}

// Handle location error
function handleError(error) {
    let errorMessage = 'Error getting location: ';
    switch(error.code) {
        case error.PERMISSION_DENIED:
            errorMessage += 'Permission denied';
            break;
        case error.POSITION_UNAVAILABLE:
            errorMessage += 'Position unavailable';
            break;
        case error.TIMEOUT:
            errorMessage += 'Timeout';
            break;
        default:
            errorMessage += 'Unknown error';
    }
    locationInfo.textContent = errorMessage;
    locationInfo.style.display = 'block';
    getLocationButton.disabled = false;
    getLocationButton.textContent = 'Get My Location';
    useFallbackValues();
}

// Fetch weather data from backend API
async function fetchWeatherData(lat, lon) {
    try {
        const response = await fetch(
            `/api/weather?lat=${lat}&lon=${lon}`
        );
        if (!response.ok) throw new Error('Weather API failed');
        
        const data = await response.json();
        weatherData.innerHTML = `
            <p>Temperature: ${data.main.temp.toFixed(1)}°C</p>
            <p>Humidity: ${data.main.humidity}%</p>
            <p>Weather: ${data.weather[0].description}</p>
        `;
    } catch (error) {
        console.error('Weather API Error:', error);
        weatherData.innerHTML = `
            <p>Temperature: ${FALLBACK_VALUES.temperature}°C (estimated)</p>
            <p>Humidity: ${FALLBACK_VALUES.humidity}% (estimated)</p>
            <p>Weather data unavailable</p>
        `;
    }
}

// Fetch carbon intensity data from backend API
async function fetchCarbonData(lat, lon) {
    try {
        const response = await fetch(
            `/api/carbon?lat=${lat}&lon=${lon}`
        );
        if (!response.ok) throw new Error('Carbon API failed');
        
        const data = await response.json();
        const carbonIntensity = data.carbonIntensity;
        
        carbonData.innerHTML = `
            <p>Carbon Intensity: ${carbonIntensity} gCO2eq/kWh</p>
            <p>Status: ${getCarbonStatus(carbonIntensity)}</p>
        `;
    } catch (error) {
        console.error('Carbon API Error:', error);
        useFallbackCarbonValues();
    }
}

// Use fallback values when APIs fail
function useFallbackValues() {
    weatherData.innerHTML = `
        <p>Temperature: ${FALLBACK_VALUES.temperature}°C (estimated)</p>
        <p>Humidity: ${FALLBACK_VALUES.humidity}% (estimated)</p>
        <p>Weather data unavailable</p>
    `;
    useFallbackCarbonValues();
}

function useFallbackCarbonValues() {
    const fallbackIntensity = FALLBACK_VALUES.carbonIntensity;
    carbonData.innerHTML = `
        <p>Carbon Intensity: ${fallbackIntensity} gCO2eq/kWh (estimated)</p>
        <p>Status: ${getCarbonStatus(fallbackIntensity)} (estimated)</p>
        <p class="note">Using global average estimation</p>
    `;
}

// Helper function to determine carbon intensity status
function getCarbonStatus(intensity) {
    if (intensity <= 100) return '🌿 Very Low Carbon';
    if (intensity <= 200) return '🌱 Low Carbon';
    if (intensity <= 400) return '🌍 Moderate Carbon';
    if (intensity <= 600) return '⚠️ High Carbon';
    return '🚨 Very High Carbon';
}
