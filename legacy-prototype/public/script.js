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

// Cluster controls
const clusterCountSlider = document.getElementById('clusterCount');
const clusterCountValue = document.getElementById('clusterCountValue');
const clusterRadiusSlider = document.getElementById('clusterRadius');
const clusterRadiusValue = document.getElementById('clusterRadiusValue');
const gridSpacingSlider = document.getElementById('gridSpacing');
const gridSpacingValue = document.getElementById('gridSpacingValue');

// Update UI values on slider change
clusterCountSlider.addEventListener('input', () => {
    clusterCountValue.textContent = clusterCountSlider.value;
});
clusterRadiusSlider.addEventListener('input', () => {
    clusterRadiusValue.textContent = clusterRadiusSlider.value;
});
gridSpacingSlider.addEventListener('input', () => {
    gridSpacingValue.textContent = parseFloat(gridSpacingSlider.value).toFixed(1);
});

// Helper: Fetch carbon data for all points with higher concurrency
async function fetchCarbonDataForPoints(points, concurrency = 30) {
    let results = new Array(points.length);
    let idx = 0;
    async function worker() {
        while (idx < points.length) {
            const i = idx++;
            try {
                const res = await fetch(`/api/carbon?lat=${points[i].lat}&lon=${points[i].lon}`);
                if (res.ok) {
                    const data = await res.json();
                    results[i] = data.carbonIntensity;
                } else {
                    results[i] = FALLBACK_VALUES.carbonIntensity;
                }
            } catch {
                results[i] = FALLBACK_VALUES.carbonIntensity;
            }
        }
    }
    await Promise.all(Array(concurrency).fill(0).map(worker));
    return results;
}

// Hexagonal binning function to group points into hexagonal regions
function hexagonalBinning(points, carbonDataArr, numHexagons, radiusMiles) {
    const n = points.length;
    if (n === 0) return [];
    
    // Find bounding box of all points
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    
    points.forEach(p => {
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
        minLon = Math.min(minLon, p.lon);
        maxLon = Math.max(maxLon, p.lon);
    });
    
    // Calculate hex grid dimensions based on number of desired hexagons
    // Adjust the number of columns and rows to approximate the desired number of hexagons
    const totalArea = (maxLat - minLat) * (maxLon - minLon);
    const hexArea = totalArea / numHexagons;
    
    // Assuming roughly equal dimensions for simplicity
    const hexWidth = Math.sqrt(hexArea);
    const hexHeight = hexWidth * 0.866; // Height = width * sin(60°)
    
    const cols = Math.max(2, Math.ceil((maxLon - minLon) / hexWidth));
    const rows = Math.max(2, Math.ceil((maxLat - minLat) / hexHeight));
    
    // Create hex bins
    const hexBins = {};
    
    // Assign points to hex bins
    points.forEach((point, idx) => {
        // Calculate hex coordinates (using axial coordinates for hexagonal grid)
        const q = Math.floor((point.lon - minLon) / hexWidth);
        // For hex grid, offset every other column
        const offset = q % 2 === 0 ? 0 : 0.5;
        const r = Math.floor((point.lat - minLat) / hexHeight - offset);
        
        // Create hex key
        const hexKey = `${q},${r}`;
        
        if (!hexBins[hexKey]) {
            hexBins[hexKey] = {
                points: [],
                carbonValues: [],
                centerLat: minLat + (r + offset) * hexHeight + hexHeight / 2,
                centerLon: minLon + q * hexWidth + hexWidth / 2,
                q: q,
                r: r
            };
        }
        
        // Add point to this hex bin
        hexBins[hexKey].points.push(point);
        hexBins[hexKey].carbonValues.push(carbonDataArr[idx]);
    });
    
    // Calculate averages for each hex bin
    return Object.entries(hexBins).map(([key, bin], index) => {
        const avgCarbonIntensity = bin.carbonValues.length > 0 ? 
            bin.carbonValues.reduce((a, b) => a + b, 0) / bin.carbonValues.length : 0;
            
        return {
            hexId: index,
            centerLat: bin.centerLat,
            centerLon: bin.centerLon,
            q: bin.q,
            r: bin.r,
            points: bin.points,
            avgCarbonIntensity: avgCarbonIntensity,
            count: bin.points.length
        };
    });
}

function euclidean(a, b) {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

// Function to create hexagon polygon coordinates from center point
function createHexagonGeometry(centerLon, centerLat, sizeInMeters) {
    require(["esri/geometry/Point", "esri/geometry/Polygon"], function(Point, Polygon) {
        // Convert size to approximate degrees based on location
        // This is a rough approximation that works for small areas
        const milesPerDegreeLat = 69.0;
        const milesPerDegreeLon = 69.172 * Math.cos(centerLat * Math.PI / 180);
        const metersPerMile = 1609.34;
        
        const radiusLat = sizeInMeters / (milesPerDegreeLat * metersPerMile);
        const radiusLon = sizeInMeters / (milesPerDegreeLon * metersPerMile);
        
        // Create hexagon points (6 points around center)
        const hexPoints = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            const x = centerLon + radiusLon * Math.cos(angle);
            const y = centerLat + radiusLat * Math.sin(angle);
            hexPoints.push([x, y]);
        }
        // Close the polygon
        hexPoints.push(hexPoints[0]);
        
        return hexPoints;
    });
}

// Render hexagons on the map with ArcGIS API
function renderHexagonsOnMap(hexBins) {
    require([
        "esri/Graphic",
        "esri/geometry/Point",
        "esri/geometry/Polygon",
        "esri/symbols/SimpleFillSymbol",
        "esri/PopupTemplate",
        "esri/layers/GraphicsLayer"
    ], function(Graphic, Point, Polygon, SimpleFillSymbol, PopupTemplate, GraphicsLayer) {
        // Create new layer for hexagons
        if (window.clusterLayer) {
            view.map.remove(window.clusterLayer);
        }
        window.clusterLayer = new GraphicsLayer({id: 'hexagons'});
        view.map.add(window.clusterLayer);
        
        // Create graphics for hexagonal bins with color based on carbon intensity
        const hexSummaries = [];
        
        // Calculate average hexagon size based on area
        const bounds = view.extent;
        if (!bounds) return;
        
        const mapWidth = bounds.xmax - bounds.xmin;
        const mapHeight = bounds.ymax - bounds.ymin;
        const mapArea = mapWidth * mapHeight;
        
        // Approximate hexagon side length based on map size and number of hexagons
        // This is rough and will need adjustment
        const numHexagons = hexBins.length;
        const hexArea = mapArea / numHexagons;
        const hexSide = Math.sqrt(hexArea / (2.6 * Math.sqrt(3)));
        
        hexBins.forEach((hexBin, idx) => {
            if (hexBin.count === 0) return;
            
            // Create hexagon polygon
            const center = [hexBin.centerLon, hexBin.centerLat];
            
            // Calculate hexagon points
            const hexPoints = [];
            const angleStep = 2 * Math.PI / 6; // 6 sides for hexagon
            const milesPerDegreeLat = 69.0;
            const milesPerDegreeLon = 69.172 * Math.cos(hexBin.centerLat * Math.PI / 180);
            
            // Calculate radius in degrees (approximate)
            // Adjust this factor based on desired hexagon size
            const sizeFactor = 0.8;
            const radiusLat = sizeFactor * (1 / milesPerDegreeLat) * Math.sqrt(hexArea);
            const radiusLon = sizeFactor * (1 / milesPerDegreeLon) * Math.sqrt(hexArea);
            
            for (let i = 0; i < 6; i++) {
                const angle = angleStep * i;
                const x = hexBin.centerLon + radiusLon * Math.cos(angle);
                const y = hexBin.centerLat + radiusLat * Math.sin(angle);
                hexPoints.push([x, y]);
            }
            
            // Close the polygon
            hexPoints.push(hexPoints[0]);
            
            // Create polygon geometry
            const polygon = new Polygon({
                rings: [hexPoints],
                spatialReference: view.spatialReference
            });
            
            // Color based on carbon intensity
            const avgCI = hexBin.avgCarbonIntensity;
            
            // Color from green (low) to red (high) based on carbon intensity
            // Green: RGB(50, 205, 50) for low intensity
            // Red: RGB(220, 20, 60) for high intensity
            let r, g, b;
            if (avgCI < 200) { // Low to medium
                // Interpolate from green to yellow
                const t = avgCI / 200;
                r = Math.round(50 * (1-t) + 255 * t);
                g = Math.round(205 * (1-t) + 255 * t);
                b = Math.round(50 * (1-t) + 0 * t);
            } else { // Medium to high
                // Interpolate from yellow to red
                const t = Math.min(1, (avgCI - 200) / 200);
                r = Math.round(255 * (1-t) + 220 * t);
                g = Math.round(255 * (1-t) + 20 * t);
                b = Math.round(0 * (1-t) + 60 * t);
            }
            
            const color = [r, g, b, 0.7]; // Semi-transparent
            
            // Add to summaries for legend
            hexSummaries.push({
                clusterIdx: idx,
                avgCI: avgCI,
                count: hexBin.count,
                color: color
            });
            
            // Create fill symbol for the hexagon
            const symbol = new SimpleFillSymbol({
                color: color,
                outline: {
                    color: "white",
                    width: 1
                }
            });
            
            // Add popup with info
            const popupTemplate = new PopupTemplate({
                title: `Hexagon ${idx + 1}`,
                content: `<b>Average Carbon Intensity:</b> ${avgCI.toFixed(1)} gCO₂/kWh<br>
                         <b>Grid Points in Hexagon:</b> ${hexBin.count}`
            });
            
            // Create and add graphic
            const graphic = new Graphic({
                geometry: polygon,
                symbol: symbol,
                popupTemplate: popupTemplate
            });
            
            window.clusterLayer.add(graphic);
        });
        
        // Update legend
        renderLegend(hexSummaries);
        
        // Hide grid/test points if hexagons are shown
        if (window.gridTestLayer && view.map.layers.includes(window.gridTestLayer)) {
            view.map.remove(window.gridTestLayer);
        }
    });
}

// Render legend for clusters
function renderLegend(clusterSummaries) {
    // Remove all legend info below the map
    const legendDiv = document.getElementById('legendContainer');
    legendDiv.innerHTML = '';
}

// Layer toggles
const toggleClusters = document.getElementById('toggleClusters');
toggleClusters.addEventListener('change', () => {
    if (window.clusterLayer) {
        if (toggleClusters.checked) {
            if (!view.map.layers.includes(window.clusterLayer)) view.map.add(window.clusterLayer);
            // Hide grid points if needed
            if (window.gridTestLayer && view.map.layers.includes(window.gridTestLayer)) {
                view.map.remove(window.gridTestLayer);
            }
        } else {
            if (view.map.layers.includes(window.clusterLayer)) view.map.remove(window.clusterLayer);
        }
    }
    // Legend visibility
    document.getElementById('legendContainer').style.display = toggleClusters.checked ? '' : 'none';
});
const toggleGrid = document.getElementById('toggleGrid');
toggleGrid.addEventListener('change', () => {
    if (window.gridTestLayer) {
        if (toggleGrid.checked) {
            if (!view.map.layers.includes(window.gridTestLayer)) view.map.add(window.gridTestLayer);
        } else {
            if (view.map.layers.includes(window.gridTestLayer)) view.map.remove(window.gridTestLayer);
        }
    }
});

// Grid sampling logic
/**
 * Generate a grid of points within a radius (in miles) around a center lat/lon
 * @param {number} centerLat
 * @param {number} centerLon
 * @param {number} radiusMiles
 * @param {number} spacingMiles
 * @returns {Array<{lat:number, lon:number}>}
 */
function generateGridPoints(centerLat, centerLon, radiusMiles, spacingMiles = 20) {
    const points = [];
    const milesPerDegreeLat = 69.0;
    const milesPerDegreeLon = 69.172 * Math.cos(centerLat * Math.PI / 180);
    const latSteps = Math.ceil(radiusMiles / spacingMiles);
    const lonSteps = Math.ceil(radiusMiles / spacingMiles);
    for (let i = -latSteps; i <= latSteps; i++) {
        for (let j = -lonSteps; j <= lonSteps; j++) {
            const dLat = i * spacingMiles / milesPerDegreeLat;
            const dLon = j * spacingMiles / milesPerDegreeLon;
            const lat = centerLat + dLat;
            const lon = centerLon + dLon;
            // Only keep points within the circle
            const distance = Math.sqrt(Math.pow(i * spacingMiles, 2) + Math.pow(j * spacingMiles, 2));
            if (distance <= radiusMiles) {
                points.push({ lat, lon });
            }
        }
    }
    return points;
}

// Track last known user location
let userLocation = null;

// Generate Hexagon Map button logic
const generateClustersBtn = document.getElementById('generateClustersBtn');
generateClustersBtn.addEventListener('click', async () => {
    if (!view) {
        alert('Map is not ready yet. Please wait until the map loads.');
        return;
    }
    generateClustersBtn.disabled = true;
    generateClustersBtn.textContent = 'Generating...';
    try {
        await view.when();
        // Prefer user location if available
        let centerLat = userLocation ? userLocation.lat : 0;
        let centerLon = userLocation ? userLocation.lon : 0;
        if (!userLocation && view.center) {
            centerLat = view.center.latitude;
            centerLon = view.center.longitude;
        }
        const radius = parseInt(clusterRadiusSlider.value, 10);
        const spacing = parseFloat(gridSpacingSlider.value);
        const points = generateGridPoints(centerLat, centerLon, radius, spacing);
        // Fetch carbon data for all points (with throttling)
        const carbonDataArr = await fetchCarbonDataForPoints(points);
        // Create hexagonal bins
        const numHexagons = parseInt(clusterCountSlider.value, 10);
        const hexBins = hexagonalBinning(points, carbonDataArr, numHexagons, radius);
        // Render hexagonal bins
        renderHexagonsOnMap(hexBins);
    } catch (err) {
        alert('Failed to generate hexagon map: ' + err.message);
        console.error(err);
    } finally {
        generateClustersBtn.disabled = false;
        generateClustersBtn.textContent = 'Generate Hexagon Map';
    }
});

// Save user location when available
async function handleSuccess(position) {
    const { latitude, longitude } = position.coords;
    userLocation = { lat: latitude, lon: longitude };
    // ...rest of your handleSuccess logic...
}

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
