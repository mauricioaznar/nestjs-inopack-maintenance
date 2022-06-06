import { BadRequestException, Injectable } from '@nestjs/common';
import { Product, ProductUpsertInput } from '../../../../common/dto/entities';
import { isEmpty } from 'class-validator';
import { ProductInventoryService } from '../../../../common/services/entities/product-inventory-service';
import { ProductInventory } from '../../../../common/dto/entities/production/product-inventory.dto';
import { PrismaService } from '../../../../common/modules/prisma/prisma.service';

@Injectable()
export class ProductsService {
    constructor(
        private prisma: PrismaService,
        private productInventoryService: ProductInventoryService,
    ) {}

    async getProduct({
        product_id,
    }: {
        product_id: number | null;
    }): Promise<Product | null> {
        if (!product_id) return null;

        return this.prisma.products.findFirst({
            where: {
                AND: [
                    {
                        id: product_id,
                    },
                    {
                        active: 1,
                    },
                ],
            },
        });
    }

    async getProducts(): Promise<Product[]> {
        return this.prisma.products.findMany({
            where: {
                active: 1,
            },
        });
    }

    async getProductInventory({
        product_id,
    }: {
        product_id: number;
    }): Promise<ProductInventory | null> {
        return this.productInventoryService.getProductInventory({
            product_id: product_id,
        });
    }

    async deleteProduct({ product_id }: { product_id: number }): Promise<void> {
        const product = await this.prisma.products.findUnique({
            where: {
                id: product_id,
            },
            rejectOnNotFound: false,
        });

        if (!product) {
            throw new BadRequestException(['Product not found']);
        }

        await this.prisma.products.update({
            data: {
                active: -1,
            },
            where: {
                id: product.id,
            },
        });
    }

    // update or insert
    async upsertInput(input: ProductUpsertInput): Promise<Product> {
        await this.validateAndCleanUpsertInput(input);

        return this.prisma.products.upsert({
            create: {
                calibre: input.calibre,
                code: input.code,
                current_group_weight: input.current_group_weight,
                current_kilo_price: input.current_kilo_price,
                description: input.description,
                width: input.width,
                length: input.length,
                product_type_id: input.product_type_id,
                order_production_type_id: input.order_production_type_id,
                packing_id: input.packing_id,
            },
            update: {
                calibre: input.calibre,
                code: input.code,
                current_group_weight: input.current_group_weight,
                current_kilo_price: input.current_kilo_price,
                description: input.description,
                width: input.width,
                length: input.length,
                product_type_id: input.product_type_id,
                order_production_type_id: input.order_production_type_id,
                packing_id: input.packing_id,
            },
            where: {
                id: input.id || 0,
            },
        });
    }

    private async validateAndCleanUpsertInput(
        input: ProductUpsertInput,
    ): Promise<void> {
        const errors: string[] = [];

        // width
        if (ProductsService.isWidthRequired(input)) {
            if (isEmpty(input.width)) {
                errors.push('Width is required');
            }
        } else {
            input.width = 0;
        }

        // length
        if (ProductsService.isLengthRequired(input)) {
            if (isEmpty(input.length)) {
                errors.push('Length is required');
            }
        } else {
            input.length = null;
        }

        // current group weight
        if (ProductsService.isCurrentGroupWeightRequired(input)) {
            if (isEmpty(input.current_group_weight)) {
                errors.push('Current group weight is required');
            }
        } else {
            input.current_group_weight = 0;
        }

        // calibre
        if (ProductsService.isCalibreRequired(input)) {
            if (isEmpty(input.calibre)) {
                errors.push('Calibre is required');
            }
        } else {
            input.calibre = 0;
        }

        // packing
        if (ProductsService.isPackingIdRequired(input)) {
            if (isEmpty(input.packing_id)) {
                errors.push('Packing is required');
            }
        } else {
            input.packing_id = null;
        }

        // product type
        // DoesProductTypeBelongToOrderProductionType
        if (input.product_type_id) {
            const productType = await this.prisma.product_type.findUnique({
                where: {
                    id: input.product_type_id,
                },
            });
            if (!productType) {
                errors.push('Product type not found');
            }
            if (
                productType &&
                productType.order_production_type_id !==
                    input.order_production_type_id
            ) {
                errors.push(
                    'Product type doesnt belong to order production type',
                );
            }
        }

        const previousProduct = await this.prisma.products.findUnique({
            where: {
                id: input.id || 0,
            },
        });

        if (!!previousProduct) {
            if (previousProduct.product_type_id !== input.product_type_id) {
                errors.push('Product type cant be changed');
            }

            if (
                previousProduct.order_production_type_id !==
                input.order_production_type_id
            ) {
                errors.push('Order production type cant be changed');
            }
        }

        if (errors.length > 0) {
            throw new BadRequestException(errors);
        }
    }

    private static isBag(input: ProductUpsertInput) {
        return input.order_production_type_id === 1;
    }

    private static isRoll(input: ProductUpsertInput) {
        return input.order_production_type_id === 2;
    }

    private static isPellet(input: ProductUpsertInput) {
        return input.order_production_type_id === 3;
    }

    private static isOthers(input: ProductUpsertInput) {
        return input.order_production_type_id === null;
    }

    private static isWidthRequired(input: ProductUpsertInput) {
        return (
            ProductsService.isBag(input) ||
            ProductsService.isRoll(input) ||
            ProductsService.isOthers(input)
        );
    }

    private static isLengthRequired(input: ProductUpsertInput) {
        return ProductsService.isBag(input) || ProductsService.isOthers(input);
    }

    private static isCurrentGroupWeightRequired(input: ProductUpsertInput) {
        return ProductsService.isBag(input) || ProductsService.isOthers(input);
    }

    private static isCalibreRequired(input: ProductUpsertInput) {
        return (
            ProductsService.isBag(input) ||
            ProductsService.isRoll(input) ||
            ProductsService.isOthers(input)
        );
    }

    private static isPackingIdRequired(input: ProductUpsertInput) {
        return ProductsService.isBag(input) || ProductsService.isRoll(input);
    }
}
