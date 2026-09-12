Palvelu Helsingin ja Espoon kaupunkipyörämatkojen visualisointiin. Pohjautuu [HSL:n ja City Bike Finlandin julkaisemaan avoimeen dataan](https://www.hsl.fi/hsl/avoin-data) (CC-BY 4.0). 

---

# Technical details

A dependency-free Python preprocessing step aggregates one monthly HSL city-bike
trip export, and a static MapLibre site displays the resulting station-to-station
flows. There is no backend or frontend build step.

## Build a month

Run **Actions → Build monthly data → Run workflow**, paste the public URL of an
HSL `.csv` or a `.zip` containing multiple monthly CSV files. Choose aggregate
files, Monthly Insights record sidecars, or both when starting the workflow. It
creates one JSON per CSV, named from the month detected in its data (for example,
`2025-04.json`), and bundles all results in the `hsl-city-bike-json` artifact.
Names are always derived from the detected month so aggregate files and their
record sidecars stay aligned. The job never commits to the repository.

Download and unzip that artifact from the workflow run summary, then put the JSON
in `site/data/` and commit it. During deployment, the Pages workflow discovers all
monthly JSON files (excluding the synthetic sample), builds a month index, and the
site makes every indexed month available in its month selector. The newest month
is selected by default, so no application code needs to change when data is added.

For local use:

```sh
python preprocess/build-data.py month.zip site/data/sample-month.json
python preprocess/build-data-batch.py several-months.zip site/data
python preprocess/build-data-batch.py several-months.zip site/data/records --kind records
python preprocess/build-data-index.py site/data
python -m http.server --directory site 8000
```

The parser accepts comma, semicolon, or tab-delimited UTF-8 CSV files, directly or
inside a ZIP. It recognizes the published HSL English headers (such as
`Departure`, `Departure station id`, `Return station id`, `Covered distance (m)`,
and `Duration (sec.)`) plus common Finnish equivalents. Malformed rows are warned
about and skipped. Missing optional duration or distance values contribute zero.
Distances may contain decimal meters and are rounded to the nearest integer meter.

## Data format

The compact JSON has a version (`v`), year (`y`), month (`m`), whole-month tuples
(`total`), daily arrays (`d`), and consecutive hourly arrays (`h`). Each tuple is:

```text
[originStationId, destinationStationId, rideCount,
 totalDurationSeconds, totalDistanceMeters]
```

`d[0]` is day 1; `h[0]` is day 1 at 00:00 and `h[24]` is day 2 at 00:00. Empty
periods remain empty arrays. Rides are aggregated, never included individually.

Monthly Insights sidecars live under `site/data/records/` and contain up to five
ranked rides for each record. Rides longer than 24 hours are excluded from every
record, and round trips are excluded from the quickest-ride ranking. Each ride
stores `origin`, `destination`, `durationS`, and `distanceM`; display speed is
derived in the browser rather than duplicated. The records build logs the count
and percentage of rides excluded by the 24-hour limit.

Station metadata is stored separately in `site/stations.js`. To refresh it, add a
repository Actions secret named `DIGITRANSIT_SUBSCRIPTION_KEY`, run **Actions →
Build station metadata → Run workflow**, download the `hsl-city-bike-stations`
artifact, and replace `site/stations.js` with the downloaded file. The workflow
queries the [Digitransit vehicle-rental API](https://digitransit.fi/en/developers/apis/1-routing-api/bicycles-scooters-cars/)
for station IDs, names, latitudes, and longitudes. It keeps Smoove bike stations,
turning IDs such as `smoove:072` into the integer `72` used by the trip data.

The same file can be built locally with Python and no third-party packages:

```sh
DIGITRANSIT_SUBSCRIPTION_KEY=... \
  python preprocess/build-stations.py site/stations.js
```

## Bicycle route geometry

Straight station-to-station connections remain the default. The **Connections →
Routes** control loads `site/routes/<selected-station-id>.json` on demand and uses
its Digitransit bicycle geometry for outgoing flows. The same geometry is reversed
for incoming flows, avoiding requests for every connected station while keeping
both directions on the same approximate route. Missing files and missing
individual routes fall back to straight lines.

To generate a bounded checkpoint, add the `DIGITRANSIT_SUBSCRIPTION_KEY` secret
and run **Actions → Build bicycle routes → Run workflow**. The defaults start at
station index 0 in `site/stations.js`, process one station, and wait 750 ms between
sequential requests. The workflow discovers required directed routes by scanning
all aggregate files in `site/data/`; it does not maintain a separate route list.
Download the artifact and copy its `routes/` directory into `site/routes/` to use
the generated files. Generated routes are never committed by the workflow.

The builder concatenates all legs in Digitransit's direct bicycle result into one
encoded route and adds their distances together. An itinerary with no legs or a
leg without geometry is considered invalid; this does not indicate corrupt trip
data. The route is retried twice and, if it still fails, is listed in
`routing-summary.json` and omitted so the site can use its straight-line fallback.
After the third failed attempt, the workflow log includes the complete GraphQL
request and API response for diagnosis; the Digitransit subscription key is always
redacted.
The build stops early only after the configured number of whole routes fail
consecutively, rather than treating one route's three attempts as three failures.

The same bounded build can be run locally:

```sh
DIGITRANSIT_SUBSCRIPTION_KEY=... \
  python preprocess/build-routes.py --start-station-index 0 --max-stations 1 --delay-ms 750
```

Trip CSVs are published through [HSL's open data resources](https://www.hsl.fi/en/hsl/open-data).

## Deployment

A push to `main` deploys only `site/` with the official GitHub Pages actions.
Enable **GitHub Actions** as the Pages source in repository settings once.

## MVP limitations / future work

- complete pre-generated cycling route coverage
- animations/particles
- PMTiles/vector tiles
- weather joins
- advanced statistics
- automatic ingestion of newly published months

Only stations present in the committed station snapshot can be drawn. Routed
flows require separately generated route files and otherwise fall back to straight
lines. Map tiles are fetched from a third party; station metadata and trip
aggregates are static files.

## Licenses

* Trip data: CC-BY 4.0 City Bike Finland 2016-2026
* Bike station data: CC-BY 4.0 HSL 2026
* The code: MIT
* Map: OpenStreetMap contributors 

---

✨ Made with vibes ✨ 
