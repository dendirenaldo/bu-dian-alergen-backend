import { Table, Column, Model, DataType, BelongsTo, HasMany, ForeignKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';
import { User } from '../../users/models/user.model';
import { Product } from '../../products/models/product.model';
import { DetectionAllergen } from './detection-allergen.model';

@Table({ tableName: 'detections', timestamps: true, underscored: true })
export class Detection extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: true, onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  userId: number;

  @Column({ type: DataType.STRING(36), allowNull: true })
  anonId: string;

  @Column({ type: DataType.STRING(64), allowNull: true })
  ipHash: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  isGuest: boolean;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'bert' })
  modelName: string;

  @ForeignKey(() => Product)
  @Column({ type: DataType.INTEGER, allowNull: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
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

  @UpdatedAt
  updatedAt: Date;
}
