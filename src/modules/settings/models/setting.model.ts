import { Table, Column, Model, DataType, UpdatedAt } from 'sequelize-typescript';

@Table({ tableName: 'settings', timestamps: false, underscored: true })
export class Setting extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @Column({ type: DataType.STRING(255), allowNull: false, unique: true })
  key: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  value: string;

  @Column({ type: DataType.ENUM('string', 'number', 'boolean', 'json'), defaultValue: 'string' })
  type: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string;

  @UpdatedAt
  updatedAt: Date;
}
