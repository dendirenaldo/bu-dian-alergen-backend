import { Table, Column, Model, DataType, BelongsTo, ForeignKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';
import { Product } from './product.model';
import { Allergen } from '../../allergens/models/allergen.model';

@Table({
  tableName: 'product_allergens',
  timestamps: false,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['product_id', 'allergen_id'],
    },
  ],
})
export class ProductAllergen extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @ForeignKey(() => Product)
  @Column({ type: DataType.INTEGER, allowNull: false, onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  productId: number;

  @ForeignKey(() => Allergen)
  @Column({ type: DataType.INTEGER, allowNull: false, onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  allergenId: number;

  @Column({ type: DataType.FLOAT, defaultValue: 0 })
  confidenceScore: number;

  @Column({ type: DataType.TEXT, allowNull: true })
  notes: string;

  @BelongsTo(() => Product)
  product: Product;

  @BelongsTo(() => Allergen)
  allergen: Allergen;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}
