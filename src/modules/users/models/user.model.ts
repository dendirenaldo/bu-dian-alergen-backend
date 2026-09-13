import { Table, Column, Model, DataType, HasMany, CreatedAt, UpdatedAt } from 'sequelize-typescript';

@Table({ tableName: 'users', timestamps: true, underscored: true })
export class User extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @Column({ type: DataType.STRING(255), allowNull: false, unique: true })
  email: string;

  @Column({ type: DataType.STRING(255), allowNull: false })
  password: string;

  @Column({ type: DataType.STRING(255), allowNull: false })
  name: string;

  @Column({ type: DataType.STRING(20), allowNull: true })
  phone: string;

  @Column({ type: DataType.STRING(500), allowNull: true })
  avatarUrl: string;

  @Column({ type: DataType.ENUM('admin', 'user'), defaultValue: 'user' })
  role: string;

  @Column({ type: DataType.BOOLEAN, defaultValue: true })
  isActive: boolean;

  @Column({ type: DataType.DATE, allowNull: true })
  lastLoginAt: Date;

  @HasMany(() => require('../../products/models/product.model').Product)
  products: any[];

  @HasMany(() => require('../../contents/models/content.model').Content)
  contents: any[];

  @HasMany(() => require('../../detections/models/detection.model').Detection)
  detections: any[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}
