# OSRM road routing for the Driver API (maps program SP4b, decision D3), on a private Fly machine
# (deploy/fly/osrm.toml). The build downloads the latest OpenStreetMap extract of Iraq from Geofabrik,
# clips it to Baghdad – Aziziyah – Kut (keeps the build and the machine small) and prepares the MLD
# car graph. Redeploy to pick up newer map data (docs/deploy/hosting.md, "Road routing").
FROM ghcr.io/project-osrm/osrm-backend:v26.10.0-debian AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl osmium-tool && rm -rf /var/lib/apt/lists/*
WORKDIR /data
# lon_min,lat_min,lon_max,lat_max: Baghdad (33.3 N, 44.4 E), Aziziyah (32.9 N, 45.06 E), Kut (32.5 N, 45.8 E) with margin.
ARG REGION_BBOX=44.0,32.3,46.2,33.6
RUN curl -fsSL -o iraq.osm.pbf https://download.geofabrik.de/asia/iraq-latest.osm.pbf \
 && osmium extract --bbox "$REGION_BBOX" --strategy complete_ways --overwrite -o region.osm.pbf iraq.osm.pbf \
 && rm iraq.osm.pbf \
 && osrm-extract -p /opt/car.lua region.osm.pbf \
 && osrm-partition region.osrm \
 && osrm-customize region.osrm \
 && rm region.osm.pbf

FROM ghcr.io/project-osrm/osrm-backend:v26.10.0-debian
COPY --from=build /data /data
EXPOSE 5000
# Fly's private network (.internal) is IPv6: listen on every address.
CMD ["osrm-routed", "--algorithm", "mld", "--ip", "::", "--port", "5000", "--max-table-size", "200", "/data/region.osrm"]
