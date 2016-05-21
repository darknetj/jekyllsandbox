/* globals define */
define([
    'jquery',
    'handlebars'
], function($, Handlebars) {
    'use strict';

    function deviceModel(device) {
        if (device === 'hammerhead') {
            return 'Nexus 5';
        }
        if (device === 'flounder') {
            return 'Nexus 9 (WiFi)';
        }
        if (device === 'flounder_lte') {
            return 'Nexus 9 (LTE)';
        }
        if (device === 'shamu') {
            return 'Nexus 6';
        }
        if (device === 'bullhead') {
            return 'Nexus 5X';
        }
        if (device === 'angler') {
            return 'Nexus 6P';
        }
    }

    function filterByDevice(device, results) {
        var filtered = [];
        results.forEach(function(build) {
            build.device = build.filename.split("-")[0];
            build.model = deviceModel(build.device);
            var date = new Date(parseInt(build.timestamp, 10) * 1000);
            build.date = date.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
            build.factory_url = build.url.replace("ota_update", "factory").replace("zip", "tar.gz")
            build.factory_filename = build.filename.replace("ota_update", "factory").replace("zip", "tar.gz")
            build.version = build.fingerprint.split("/")[3] + "." + build.fingerprint.split("/")[4].split(":")[0];
            if (!device || device === build.device) {
                filtered.push(build);
            }
        });
        return filtered;
    }

    function init() {
        if ($('#subpage-builds').length) {
            var url = URI(window.location.href);
            var selectedDevice;
            var filters = $('.device-filter a');
            if (url.hasQuery('device')) {
                url.hasQuery('device', function(value, name, data) {
                    selectedDevice = value;
                    return true;
                });
                filters.each(function(d) {
                    var filter = $(filters[d]);
                    var filterDevice = filter.data('device');
                    console.log(filterDevice, selectedDevice)
                    if (filterDevice === selectedDevice) {
                        filter.addClass('device-selected');
                    }
                });
            }
            var source = "<tr><td>{{date}}</td><td>{{ model }}</td><td>{{ version }}</td><td><a href='{{ factory_url }}'>{{ factory_filename }}</a><br><a href='{{ factory_url}}.sig'>{{ factory_filename }}.sig</a></td> <td><a href='{{ url }}'>{{ filename }}</a></td></tr>";
            var template = Handlebars.compile(source);

            var empty = "<tr><td colspan='6' class='center'>No builds available for this device</td></tr>";

            $.ajax({
                url: "https://builds.copperhead.co/releases.json",
                type: "GET",
                crossDomain: true,
                dataType: "json",
                success: function (response) {
                    var results = filterByDevice(selectedDevice, response.result);
                    if (results.length > 0) {
                        results.forEach(function(build) {
                            var html = template(build);
                            $(".builds-table").append(html);
                        });
                    } else {
                        $(".builds-table").append(empty);
                    }
                },
                error: function (xhr, status) {
                    console.log("error");
                }
            });
        }
    }

    return {
        init: init
    };
});
