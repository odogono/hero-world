/** Set by build.ts: whether this is a development build, with the dev sign-in */
declare const MUA_DEV: boolean;

/** Set by build.ts: the release version, from mua_server's mix.exs */
declare const MUA_VERSION: string;

/** Stylesheets are bundled by build.ts */
declare module '*.css';
