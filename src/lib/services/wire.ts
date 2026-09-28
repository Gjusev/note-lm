/** Row → Convex-shaped wire object. The UI contract uses `_id`, so services
 *  return this shape and the API layer passes it through unchanged. */
export function toWire<T extends { id: string }>(row: T): Omit<T, "id"> & { _id: string } {
  const { id, ...rest } = row;
  return { _id: id, ...rest };
}
