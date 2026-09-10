import { Table, Column, Model, DataType, HasMany, CreatedAt, UpdatedAt } from 'sequelize-typescript';
import { Product } from '../../products/models/product.model';

@Table({ tableName: 'categories', timestamps: true, underscored: true })
export class Category extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @Column({ type: DataType.STRING(255), allowNull: false, unique: true })
  name: string;

  @Column({ type: DataType.STRING(255), allowNull: false, unique: true })
  slug: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string;

  @Column({ type: DataType.STRING(500), allowNull: true })
  imageUrl: string;

  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  sortOrder: number;

  @Column({ type: DataType.BOOLEAN, defaultValue: true })
  isActive: boolean;

  @HasMany(() => Product)
  products: Product[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}
