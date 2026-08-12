import { readFile, stat } from "node:fs/promises";
import sharp from "sharp";

type Point3 = [number, number, number];
type Point2 = [number, number];

interface ProjectedFace {
  points: Point2[];
  depth: number;
  light: number;
}

function project([x, y, z]: Point3): [number, number, number] {
  return [(x - z) * 0.866, y - (x + z) * 0.5, x + y + z];
}

function faceLight(a: Point3, b: Point3, c: Point3): number {
  const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
  const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return Math.max(0.18, Math.min(1, (nx * -0.35 + ny * 0.8 + nz * 0.45) / length * 0.5 + 0.5));
}

export async function renderObjThumbnail(
  source: string,
  outputPath: string,
  width: number,
  height: number,
): Promise<void> {
  const info = await stat(source);
  if (info.size > 64 * 1024 * 1024) throw new Error("OBJ_THUMBNAIL_TOO_LARGE");
  const text = await readFile(source, "utf8");
  const vertices: Point3[] = [];
  const faces: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ") && vertices.length < 500_000) {
      const values = line.slice(2).trim().split(/\s+/).slice(0, 3).map(Number);
      if (values.length === 3 && values.every(Number.isFinite)) vertices.push(values as Point3);
    } else if (line.startsWith("f ") && faces.length < 500_000) {
      const indices = line.slice(2).trim().split(/\s+/).map((value) => Number(value.split("/")[0])).filter(Number.isInteger);
      if (indices.length >= 3) faces.push(indices.map((index) => index < 0 ? vertices.length + index : index - 1));
    }
  }
  if (!vertices.length || !faces.length) throw new Error("OBJ_THUMBNAIL_EMPTY");
  const projected = vertices.map(project);
  const minX = Math.min(...projected.map((point) => point[0]));
  const maxX = Math.max(...projected.map((point) => point[0]));
  const minY = Math.min(...projected.map((point) => point[1]));
  const maxY = Math.max(...projected.map((point) => point[1]));
  const scale = Math.min((width * 0.78) / Math.max(1e-6, maxX - minX), (height * 0.78) / Math.max(1e-6, maxY - minY));
  const offsetX = width / 2 - ((minX + maxX) / 2) * scale;
  const offsetY = height / 2 - ((minY + maxY) / 2) * scale;
  const polygons: ProjectedFace[] = faces.flatMap((face) => {
    const points3 = face.map((index) => vertices[index]).filter(Boolean);
    if (points3.length < 3) return [];
    return [{
      points: points3.map((point) => {
        const next = project(point);
        return [next[0] * scale + offsetX, next[1] * scale + offsetY] as Point2;
      }),
      depth: points3.reduce((sum, point) => sum + project(point)[2], 0) / points3.length,
      light: faceLight(points3[0], points3[1], points3[2]),
    }];
  }).sort((left, right) => left.depth - right.depth);
  const body = polygons.map((face) => {
    const value = Math.round(78 + face.light * 112);
    const points = face.points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    return `<polygon points="${points}" fill="rgb(${value},${value + 4},${value + 2})" stroke="rgba(20,24,23,0.55)" stroke-width="0.7"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#202423"/>${body}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}
