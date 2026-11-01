// ts-pegjs ships no type declarations; it is a Peggy plugin
declare module 'ts-pegjs' {
  import type { Plugin } from 'peggy';

  const tspegjs: Plugin;
  export default tspegjs;
}
