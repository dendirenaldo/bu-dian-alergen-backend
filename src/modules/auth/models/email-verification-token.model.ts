import { Table, Column, Model, DataType, BelongsTo, ForeignKey, CreatedAt } from 'sequelize-typescript';
import { User } from '../../users/models/user.model';

@Table({ tableName: 'email_verification_tokens', timestamps: false, underscored: true })
export class EmailVerificationToken extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false, onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @Column({ type: DataType.STRING(64), allowNull: false, unique: true })
  tokenHash: string;

  @Column({ type: DataType.DATE, allowNull: false })
  expiresAt: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  usedAt: Date;

  @CreatedAt
  createdAt: Date;
}
