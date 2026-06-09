// Local d3 barrel: re-exports only the d3 functions this graph actually uses,
// so we depend on the four needed submodules instead of the full `d3`
// meta-package (which pulls in ~30 packages for scales, shapes, geo, etc.).
export { select } from 'd3-selection';
export { zoom, zoomIdentity, zoomTransform } from 'd3-zoom';
export { drag } from 'd3-drag';
export { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
