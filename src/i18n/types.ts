/** Misma forma que el catálogo en español: TypeScript avisa si falta o sobra una clave en otro idioma. */
export type Messages<T> = { [K in keyof T]: T[K] extends string ? string : Messages<T[K]> };
