import { Table, Column, Model, DataType, BelongsTo, ForeignKey, CreatedAt } from 'sequelize-typescript';
import { Detection } from './detection.model';
import { Allergen } from '../../allergens/models/allergen.model';

@Table({
  tableName: 'detection_allergens',
  timestamps: false,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['detection_id', 'allergen_id'],
    },
  ],
})
export class DetectionAllergen extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @ForeignKey(() => Detection)
  @Column({ type: DataType.INTEGER, allowNull: false })
  detectionId: number;

  @ForeignKey(() => Allergen)
  @Column({ type: DataType.INTEGER, allowNull: false })
  allergenId: number;

  @Column({ type: DataType.FLOAT, defaultValue: 0 })
  confidenceScore: number;

  @BelongsTo(() => Detection)
  detection: Detection;

  @BelongsTo(() => Allergen)
  allergen: Allergen;

  @CreatedAt
  createdAt: Date;
}
