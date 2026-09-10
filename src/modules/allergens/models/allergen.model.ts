import { Table, Column, Model, DataType, CreatedAt, UpdatedAt } from 'sequelize-typescript';

@Table({ tableName: 'allergens', timestamps: true, underscored: true })
export class Allergen extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @Column({ type: DataType.STRING(255), allowNull: false, unique: true })
  name: string;

  @Column({ type: DataType.STRING(50), allowNull: false, unique: true })
  code: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string;

  @Column({ type: DataType.STRING(500), allowNull: true })
  iconUrl: string;

  @Column({ type: DataType.ENUM('low', 'medium', 'high', 'critical'), defaultValue: 'medium' })
  severityLevel: string;

  @Column({ type: DataType.STRING(7), allowNull: true })
  color: string;

  @Column({ type: DataType.BOOLEAN, defaultValue: true })
  isActive: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}
