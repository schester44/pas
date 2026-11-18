import type { Product } from "../domain/product";

export interface ProductDto {
  id: string;
  key: string;
  name: string;
  lineOfBusiness: string;
  status: string;
  createdAt: string;
}

export function toProductDto(product: Product): ProductDto {
  const p = product.toSnapshot();
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    lineOfBusiness: p.lineOfBusiness,
    status: p.status,
    createdAt: p.createdAt.toString(),
  };
}
