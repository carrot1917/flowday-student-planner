// Minimal ambient declaration so `import x from '...?raw'` type-checks under
// `tsc -b` without pulling in @types/node. Vite (and thus Vitest) resolves
// the `?raw` suffix natively at runtime.
declare module '*?raw' {
  const content: string;
  export default content;
}
