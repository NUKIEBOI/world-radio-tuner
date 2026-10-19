declare module "*.css";

// hatch-maps.js is loaded as a text asset and injected as a classic
// script at runtime (see ReceiverMap.tsx): it declares a global
// `HatchMaps`, which is how the map runtime is designed to load.
declare module "*.txt" {
  const src: string;
  export default src;
}
