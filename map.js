mapboxgl.accessToken = 'pk.eyJ1IjoiY3BhcmswNyIsImEiOiJjbTdjdDJjYW8wdXZvMmtwcDZ6Z3oycTQyIn0.FBMGq56vNl2j-Cm9OPglCg';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18
});

let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

map.on('load', () => {
    const cities = [
        {name: 'boston', file: 'bike_data/Existing_Bike_Network_Boston_2022.geojson'},
        {name: 'cambridge', file: 'bike_data/Existing_Bike_Network_Cambridge_2022.geojson'}
    ];

    cities.forEach(city => {
        addBikeLanes(city.name, city.file);
    });

    const svg = d3.select('#map').append('svg');
    let stations = [];
    const radiusScale = d3.scaleSqrt().range([0, 25]);

    d3.json('bike_data/bluebikes-stations.json').then(jsonData => {
        stations = jsonData.data.stations;

        d3.csv('bike_data/bluebikes-traffic-2024-03.csv').then(trips => {
            for (let trip of trips) {
                trip.started_at = new Date(trip.started_at);
                trip.ended_at = new Date(trip.ended_at);

                let startedMinutes = minutesSinceMidnight(trip.started_at);
                departuresByMinute[startedMinutes].push(trip);

                let endedMinutes = minutesSinceMidnight(trip.ended_at);
                arrivalsByMinute[endedMinutes].push(trip);
            }

            let timeFilter = -1;
            const timeSlider = document.getElementById('time-slider');
            const selectedTime = document.getElementById('selected-time');

            function formatTime(minutes) {
                const date = new Date(0, 0, 0, 0, minutes);
                return date.toLocaleString('en-US', { timeStyle: 'short' });
            }

            function filterByMinute(tripsByMinute, minute) {
                if (minute === -1) {
                    return tripsByMinute.flat();
                }

                let minMinute = (minute - 60 + 1440) % 1440;
                let maxMinute = (minute + 60) % 1440;
              
                if (minMinute > maxMinute) {
                    let beforeMidnight = tripsByMinute.slice(minMinute);
                    let afterMidnight = tripsByMinute.slice(0, maxMinute);
                    return beforeMidnight.concat(afterMidnight).flat();
                  } else {
                    return tripsByMinute.slice(minMinute, maxMinute).flat();
                  }
            }

            function getCoords(station) {
                const point = new mapboxgl.LngLat(+station.lon, +station.lat);
                return map.project(point);
            }

            function updateTimeDisplay() {
                timeFilter = Number(timeSlider.value);
                selectedTime.textContent = timeFilter === -1 ? 'Any Time' : formatTime(timeFilter);

                const filteredDepartures = filterByMinute(departuresByMinute, timeFilter);
                const filteredArrivals = filterByMinute(arrivalsByMinute, timeFilter);

                const stationTraffic = new Map();
                for (const trip of filteredDepartures) {
                    const id = trip.start_station_id;
                    const traffic = stationTraffic.get(id) || { dep: 0, arr: 0 };
                    traffic.dep++;
                    stationTraffic.set(id, traffic);
                }
                for (const trip of filteredArrivals) {
                    const id = trip.end_station_id;
                    const traffic = stationTraffic.get(id) || { dep: 0, arr: 0 };
                    traffic.arr++;
                    stationTraffic.set(id, traffic);
                }

                const filteredStations = stations.map(station => {
                    const traffic = stationTraffic.get(station.short_name) || { dep: 0, arr: 0 };
                    return {
                        ...station,
                        departures: traffic.dep,
                        arrivals: traffic.arr,
                        totalTraffic: traffic.dep + traffic.arr
                    };
                });

                radiusScale.range(timeFilter === -1 ? [2, 10] : [2, 20])
                    .domain([0, 2000]);

                const circles = svg.selectAll('circle')
                    .data(filteredStations);

                circles.exit().remove();

                circles.enter()
                    .append('circle')
                    .merge(circles)
                    .attr('r', d => radiusScale(d.totalTraffic))
                    .attr('fill', 'steelblue')
                    .attr('stroke', 'white')
                    .attr('stroke-width', 1)
                    .attr('opacity', 0.6)
                    .style("--departure-ratio", d => {
                        if (d.totalTraffic === 0) return 0;
                        return stationFlow(d.departures / d.totalTraffic)
                    })
                    .each(function(d) {
                        d3.select(this)
                          .select('title')
                          .remove();
                        d3.select(this)
                          .append('title')
                          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
                      });

                function updatePositions() {
                    svg.selectAll('circle')
                        .attr('cx', d => getCoords(d).x)
                        .attr('cy', d => getCoords(d).y);
                }
                updatePositions();

                // Map event listeners
                map.on('move', updatePositions);
                map.on('zoom', updatePositions);
                map.on('resize', updatePositions);
                map.on('moveend', updatePositions);
            }

            updateTimeDisplay();
            timeSlider.addEventListener('input', updateTimeDisplay);
        }).catch(error => {
            console.error('Error loading trips data:', error);
        });
    }).catch(error => {
        console.error('Error loading stations data:', error);
    });
});

function addBikeLanes(cityName, geojsonFile) {
    map.addSource(`${cityName}_route`, {
        type: 'geojson',
        data: geojsonFile
    });

    map.addLayer({
        id: `${cityName}-bike-lanes`,
        type: 'line',
        source: `${cityName}_route`,
        paint: {
            'line-color': 'green',
            'line-width': 3,
            'line-opacity': 0.6
        }
    });
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}