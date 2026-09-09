import { registerHooks } from 'node:module';

// Node strips TS syntax; resolve the extensionless imports used by Convex.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
        try { return nextResolve(`${specifier}.ts`, context); }
        catch { return nextResolve(`${specifier}.js`, context); }
      }
      throw error;
    }
  },
});
