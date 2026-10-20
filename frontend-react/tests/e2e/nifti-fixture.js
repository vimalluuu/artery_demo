// Synthetic asymmetric landmarks only. These are not clinical images.
export function syntheticNifti({ mask = false, affine, shape = [12, 10, 8], qformCode = 0 } = {}) {
  affine ||= [[-0.7, 0, 0, 24], [0, 1.2, 0, -13], [0, 0, 2.5, 42], [0, 0, 0, 1]];
  const bytes = mask ? 1 : 2;
  const data = Buffer.alloc(352 + shape.reduce((a, b) => a * b, 1) * bytes);
  data.writeInt32LE(348, 0);
  data.writeInt16LE(3, 40);
  shape.forEach((n, i) => data.writeInt16LE(n, 42 + i * 2));
  data.writeInt16LE(mask ? 2 : 4, 70);
  data.writeInt16LE(bytes * 8, 72);
  data.writeFloatLE(1, 76);
  [0, 1, 2].forEach((i) => data.writeFloatLE(Math.hypot(...affine.slice(0, 3).map(r => r[i])), 80 + i * 4));
  data.writeFloatLE(352, 108);
  data.writeFloatLE(1, 112);
  data[123] = 2; // millimetres
  data.writeInt16LE(qformCode, 252);
  data.writeInt16LE(1, 254);
  affine.slice(0, 3).forEach((row, i) => row.forEach((v, j) => data.writeFloatLE(v, 280 + i * 16 + j * 4)));
  data.write('n+1\0', 344, 'binary');
  for (let k = 0; k < shape[2]; k++) for (let j = 0; j < shape[1]; j++) for (let i = 0; i < shape[0]; i++) {
    const index = i + shape[0] * (j + shape[1] * k);
    const landmark = i >= 2 && i <= 4 && j >= 3 && j <= 5 && k >= 1 && k <= 3;
    if (mask) data[352 + index] = landmark ? 1 : 0;
    else data.writeInt16LE(landmark ? 600 : -150 + i * 3 + j * 7 + k * 10, 352 + index * bytes);
  }
  return data;
}
