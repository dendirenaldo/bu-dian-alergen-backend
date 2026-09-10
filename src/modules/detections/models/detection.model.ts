import { Table, Column, Model, DataType, BelongsTo, HasMany, ForeignKey, CreatedAt } from 'sequelize-typescript';
import { User } from '../../users/models/user.model';
import { Product } from '../../products/models/product.model';
import { DetectionAllergen } from './detection-allergen.model';

@Table({ tableName: 'detections', timestamps: false, underscored: true })
export class Detection extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId: number;

  @ForeignKey(() => Product)
  @Column({ type: DataType.INTEGER, allowNull: true })
  productId: number;

  @Column({ type: DataType.STRING(500), allowNull: true })
  imageUrl: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  ocrText: string;

  @Column({ type: DataType.JSON, allowNull: true })
  rawModelOutput: any;

  @Column({ type: DataType.ENUM('safe', 'unsafe'), allowNull: false })
  result: string;

  @Column({ type: DataType.FLOAT, defaultValue: 0 })
  confidenceScore: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  processingTimeMs: number;

  @Column({ type: DataType.ENUM('image_ocr', 'text_input'), allowNull: false })
  detectionMethod: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  notes: string;

  @BelongsTo(() => User)
  user: User;

  @BelongsTo(() => Product)
  product: Product;

  @HasMany(() => DetectionAllergen)
  detectionAllergens: DetectionAllergen[];

  @CreatedAt
  createdAt: Date;
}
