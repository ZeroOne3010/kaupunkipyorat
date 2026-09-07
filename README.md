# HSL city-bike flows MVP

A dependency-free Python preprocessing step aggregates one monthly HSL city-bike
trip export, and a static MapLibre site displays the resulting station-to-station
flows. There is no backend or frontend build step.

## Build a month

Run **Actions → Build monthly data → Run workflow**, paste the public URL of an
HSL `.csv` or a `.zip` containing multiple monthly CSV files. The workflow creates
one JSON per CSV, named from the month detected in its data (for example,
`2025-04.json`), and bundles all results in the `hsl-city-bike-json` artifact. An
optional custom filename can still be used when the source has exactly one CSV.
The job never commits to the repository. The names `months.json` and
`sample-month.json` are reserved for the generated index and synthetic demo data
and cannot be used as workflow output filenames.

Download and unzip that artifact from the workflow run summary, then put the JSON
in `site/data/` and commit it. During deployment, the Pages workflow discovers all
monthly JSON files (excluding the synthetic sample), builds a month index, and the
site makes every indexed month available in its month selector. The newest month
is selected by default, so no application code needs to change when data is added.

For local use:

```sh
python preprocess/build-data.py month.zip site/data/sample-month.json
python preprocess/build-data-batch.py several-months.zip site/data
python preprocess/build-data-index.py site/data
python -m http.server --directory site 8000
```

The parser accepts comma, semicolon, or tab-delimited UTF-8 CSV files, directly or
inside a ZIP. It recognizes the published HSL English headers (such as
`Departure`, `Departure station id`, `Return station id`, `Covered distance (m)`,
and `Duration (sec.)`) plus common Finnish equivalents. Malformed rows are warned
about and skipped. Missing optional duration or distance values contribute zero.

## Data format

The compact JSON has a version (`v`), year (`y`), month (`m`), whole-month tuples
(`total`), daily arrays (`d`), and consecutive hourly arrays (`h`). Each tuple is:

```text
[originStationId, destinationStationId, rideCount,
 totalDurationSeconds, totalDistanceMeters]
```

`d[0]` is day 1; `h[0]` is day 1 at 00:00 and `h[24]` is day 2 at 00:00. Empty
periods remain empty arrays. Rides are aggregated, never included individually.

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

Trip CSVs are published through [HSL's open data resources](https://www.hsl.fi/en/hsl/open-data).

## Deployment

A push to `main` deploys only `site/` with the official GitHub Pages actions.
Enable **GitHub Actions** as the Pages source in repository settings once. The
committed sample is synthetic but exercises month, day, hour, direction, and
station selection; replace it with a workflow-produced month for real data.

## MVP limitations / future work

- multiple months/years
- realistic cycling routes
- route geometry preprocessing
- animations/particles
- PMTiles/vector tiles
- weather joins
- advanced statistics
- automatic ingestion of newly published months

Only stations present in the committed station snapshot can be drawn, flows are
straight lines, and the UI provides basic filtering rather than analysis. Map
tiles are fetched from a third party; station metadata and trip aggregates are
static files.
