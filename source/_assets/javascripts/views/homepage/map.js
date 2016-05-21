/* globals define, google */
define([], function() {
    'use strict';

    // Google Maps Scripts
    var create = function() {
        var script = document.createElement('script');
        var api_key = 'AIzaSyCRngKslUGJTlibkQ3FkfTxj3Xss1UlZDA';
        script.src = 'https://maps.googleapis.com/maps/api/js?callback=init_maps&sensor=false&key=' + api_key;
        script.async = false;
        document.head.appendChild(script);
    };

    var init = function() {
       // Basic options for a simple Google Map
        // For more options see: https://developers.google.com/maps/documentation/javascript/reference#MapOptions
        var mapOptions = {
            // How zoomed in you want the map to start at (always required)
            zoom: 15,

            // The latitude and longitude to center the map (always required)
            center: new google.maps.LatLng(43.6548735, -79.3851038), // Toronto

            // Disables the default Google Maps UI components
            disableDefaultUI: true,
            scrollwheel: false,
            draggable: false,

            // How you would like to style the map.
            // This is where you would paste any style found on Snazzy Maps.
            styles: [{
                'featureType': 'water',
                'elementType': 'geometry',
                'stylers': [{
                    'color': '#000000'
                }, {
                    'lightness': 17
                }]
            }, {
                'featureType': 'landscape',
                'elementType': 'geometry',
                'stylers': [{
                    'color': '#000000'
                }, {
                    'lightness': 20
                }]
            }, {
                'featureType': 'road.highway',
                'elementType': 'geometry.fill',
                'stylers': [{
                    'color': '#000000'
                }, {
                    'lightness': 17
                }]
            }, {
                'featureType': 'road.highway',
                'elementType': 'geometry.stroke',
                'stylers': [{
                    'color': '#000000'
                }, {
                    'lightness': 29
                }, {
                    'weight': 0.2
                }]
            }, {
                'featureType': 'road.arterial',
                'elementType': 'geometry',
                'stylers': [{
                    'color': '#000000'
                }, {
                    'lightness': 18
                }]
            }, {
                'featureType': 'road.local',
                'elementType': 'geometry',
                'stylers': [{
                    'color': '#000000'
                }, {
                    'lightness': 16
                }]
            }, {
                'featureType': 'poi',
                'elementType': 'geometry',
                'stylers': [{
                    'color': '#000000'
                }, {
                    'lightness': 21
                }]
            }, {
                'elementType': 'labels.text.stroke',
                'stylers': [{
                    'visibility': 'on'
                }, {
                    'color': '#000000'
                }, {
                    'lightness': 16
                }]
            }, {
                'elementType': 'labels.text.fill',
                'stylers': [{
                    'saturation': 36
                }, {
                    'color': '#000000'
                }, {
                    'lightness': 40
                }]
            }, {
                'elementType': 'labels.icon',
                'stylers': [{
                    'visibility': 'off'
                }]
            }, {
                'featureType': 'transit',
                'elementType': 'geometry',
                'stylers': [{
                    'color': '#000000'
                }, {
                    'lightness': 19
                }]
            }, {
                'featureType': 'administrative',
                'elementType': 'geometry.fill',
                'stylers': [{
                    'color': '#000000'
                }, {
                    'lightness': 20
                }]
            }, {
                'featureType': 'administrative',
                'elementType': 'geometry.stroke',
                'stylers': [{
                    'color': '#000000'
                }, {
                    'lightness': 17
                }, {
                    'weight': 1.2
                }]
            }]
        };

        // Get the HTML DOM element that will contain your map
        // We are using a div with id='map' seen below in the <body>
        var mapElement = document.getElementById('map');

        // Create the Google Map using out element and options defined above
        var map = new google.maps.Map(mapElement, mapOptions);

        // Custom Map Marker Icon - Customize the map-marker.png file to customize your icon
        var myLatLng = new google.maps.LatLng(43.6548735, -79.3851038);
        var beachMarker = new google.maps.Marker({
            position: myLatLng,
            map: map,
            icon: window.GMAPS_MARKER_IMAGE
        });
    };

    return {
        init: init,
        create: create
    };
});
