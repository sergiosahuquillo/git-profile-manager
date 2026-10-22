// Paneles repartidos en columnas sin huecos: cada uno va a la columna más baja, en el orden en que llegan
// (la primera fila son los primeros paneles). El número de columnas depende del ancho disponible.
//
// Todos los paneles comparten un único contenedor y se colocan con `transform`: así, al cambiar de columna
// no se vuelven a montar (no pierden foco ni estado) y el orden de tabulación sigue siendo el del código.
import {
  Children,
  isValidElement,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type Props = {
  children: ReactNode;
  /** Ancho mínimo de una columna, en px. */
  minColumn?: number;
  maxColumns?: number;
  /** Separación entre paneles, en px (igual que `--space-4`). */
  gap?: number;
};

const sameHeights = (a: number[], b: number[]) => a.length === b.length && a.every((h, i) => h === b[i]);

export function Masonry({ children, minColumn = 340, maxColumns = 4, gap = 16 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<number[]>([]);
  const items = Children.toArray(children).filter(isValidElement);

  const observer = useRef<ResizeObserver | null>(null);

  // Ancho del contenedor y alto de cada panel. Solo provoca otro render si algo cambió.
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const next = Array.from(el.children, (n) => (n as HTMLElement).offsetHeight);
    setHeights((prev) => (sameHeights(prev, next) ? prev : next));
  }, []);

  // Lo que cambia sin pasar por React (tamaño de la ventana, contenido de un panel que se renderiza por su
  // cuenta, como el progreso de una actualización) llega por el observador.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    observer.current = ro;
    return () => {
      ro.disconnect();
      observer.current = null;
    };
  }, [measure]);

  // Tras cada render se mide antes de pintar (el primer fotograma ya sale repartido) y se observan los
  // paneles actuales; observar uno que ya lo está no hace nada.
  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (el && observer.current) for (const n of Array.from(el.children)) observer.current.observe(n);
  });

  const cols = Math.min(maxColumns, Math.max(1, Math.floor((width + gap) / (minColumn + gap))));
  const colWidth = (width - gap * (cols - 1)) / cols;
  const tops = new Array<number>(cols).fill(0);
  const placed = items.map((_, i) => {
    const col = tops.indexOf(Math.min(...tops));
    const at = { x: col * (colWidth + gap), y: tops[col] };
    tops[col] += (heights[i] ?? 0) + gap;
    return at;
  });
  const measured = width > 0 && heights.length === items.length;

  return (
    <div
      ref={ref}
      className={`masonry${measured ? "" : " is-measuring"}`}
      style={measured ? { height: Math.max(0, Math.max(...tops) - gap) } : undefined}
    >
      {items.map((child, i) => (
        <div
          key={child.key ?? i}
          className="masonry-item"
          style={
            width
              ? { width: colWidth, transform: `translate(${placed[i].x}px, ${placed[i].y}px)` }
              : undefined
          }
        >
          {child}
        </div>
      ))}
    </div>
  );
}
