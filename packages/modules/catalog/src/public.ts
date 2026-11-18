// Public surface of the catalog module. Other modules and apps import only from here.
export {
  makeCreateProduct,
  type CreateProduct,
  type CreateProductInput,
} from "./application/create-product";
export { makeListProducts, type ListProducts } from "./application/list-products";
export type { ProductDto } from "./application/dto";
export type { ProductRepository } from "./ports/product-repository";
