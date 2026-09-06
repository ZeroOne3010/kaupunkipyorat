# HSL city-bike flows MVP

A dependency-free Python preprocessing step aggregates one monthly HSL city-bike
trip export, and a static MapLibre site displays the resulting station-to-station
flows. There is no backend or frontend build step.

## Build a month

Run **Actions → Build monthly data → Run workflow**, paste the public URL of an
HSL monthly `.csv` or `.zip`, and optionally set the JSON filename. When left
blank, the filename is derived from the URL, so `2025-04.csv` produces
`2025-04.json`. The job downloads the source, runs `preprocess/build-data.py`,
validates the result, and creates the `hsl-city-bike-json` artifact. It never
commits to the repository.

Download and unzip that artifact from the workflow run summary, then put the JSON
in `site/data/` and commit it. During deployment, the Pages workflow discovers all
monthly JSON files (excluding the synthetic sample), builds a month index, and the
site makes every indexed month available in its month selector. The newest month
is selected by default, so no application code needs to change when data is added.

For local use:

```sh
python preprocess/build-data.py month.zip site/data/sample-month.json
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

The demo station metadata is a deliberately small subset transcribed from HSL's
[city-bike GBFS station information feed](https://digitransit.fi/en/developers/apis/3-routing-api/bicycling/). Trip CSVs are published through
[HSL's open data resources](https://www.hsl.fi/en/hsl/open-data).

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

Only the hard-coded stations can be drawn, flows are straight lines, and the UI
provides basic filtering rather than analysis. Station metadata and map tiles are
fetched from third parties; the trip aggregates themselves are static.
