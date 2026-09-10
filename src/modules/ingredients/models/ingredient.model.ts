import { Table, Column, Model, DataType, BelongsTo, ForeignKey, CreatedAt } from 'sequelize-typescript';
import { Product } from '../../products/models/product.model';

@Table({ tableName: 'ingredients', timestamps: false, underscored: true })
export class Ingredient extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @ForeignKey(() => Product)
  @Column({ type: DataType.INTEGER, allowNull: false, onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  productId: number;

  @Column({ type: DataType.TEXT, allowNull: false })
  text: string;

  @BelongsTo(() => Product)
  product: Product;

  @CreatedAt
  createdAt: Date;
}
