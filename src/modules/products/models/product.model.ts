import { Table, Column, Model, DataType, BelongsTo, HasMany, ForeignKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';
import { Category } from '../../categories/models/category.model';
import { Ingredient } from '../../ingredients/models/ingredient.model';
import { User } from '../../users/models/user.model';

@Table({ tableName: 'products', timestamps: true, underscored: true })
export class Product extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @Column({ type: DataType.STRING(255), allowNull: false })
  name: string;

  @Column({ type: DataType.STRING(255), allowNull: false, unique: true })
  slug: string;

  @ForeignKey(() => Category)
  @Column({ type: DataType.INTEGER, allowNull: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  categoryId: number;

  @Column({ type: DataType.STRING(255), allowNull: true })
  brand: string;

  @Column({ type: DataType.STRING(50), allowNull: true, unique: true })
  barcode: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string;

  @Column({ type: DataType.STRING(500), allowNull: true })
  imageUrl: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  createdBy: number;

  @Column({ type: DataType.BOOLEAN, defaultValue: true })
  isActive: boolean;

  @BelongsTo(() => Category)
  category: Category;

  @BelongsTo(() => User)
  creator: User;

  @HasMany(() => Ingredient)
  ingredients: Ingredient[];

  @HasMany(() => require('../../detections/models/detection.model').Detection)
  detections: any[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}
