import { Table, Column, Model, DataType, BelongsTo, ForeignKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';
import { User } from '../../users/models/user.model';

@Table({ tableName: 'contents', timestamps: true, underscored: true })
export class Content extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @Column({ type: DataType.STRING(255), allowNull: false })
  title: string;

  @Column({ type: DataType.STRING(255), allowNull: false, unique: true })
  slug: string;

  @Column({ type: DataType.TEXT('long'), allowNull: true })
  body: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  excerpt: string;

  @Column({ type: DataType.ENUM('page', 'article', 'announcement'), defaultValue: 'page' })
  type: string;

  @Column({ type: DataType.ENUM('draft', 'published', 'archived'), defaultValue: 'draft' })
  status: string;

  @Column({ type: DataType.STRING(500), allowNull: true })
  featuredImageUrl: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  metaTitle: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  metaDescription: string;

  @Column({ type: DataType.DATE, allowNull: true })
  publishedAt: Date;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  createdBy: number;

  @BelongsTo(() => User)
  author: User;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}
