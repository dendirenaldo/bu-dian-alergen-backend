import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import { DatasetItem } from '../src/modules/dataset/models/dataset-item.model';
import { Detection } from '../src/modules/detections/models/detection.model';
import { User } from '../src/modules/users/models/user.model';
import { Category } from '../src/modules/categories/models/category.model';
import { Product } from '../src/modules/products/models/product.model';
import { ProductAllergen } from '../src/modules/products/models/product-allergen.model';
import { Ingredient } from '../src/modules/ingredients/models/ingredient.model';
import { Allergen } from '../src/modules/allergens/models/allergen.model';
import { DetectionAllergen } from '../src/modules/detections/models/detection-allergen.model';
import { FreeDetectionLog } from '../src/modules/detections/models/free-detection-log.model';
import { FreeDetectionCounter } from '../src/modules/detections/models/free-detection-counter.model';
import { Content } from '../src/modules/contents/models/content.model';
import { Setting } from '../src/modules/settings/models/setting.model';

test('filter json like', async () => {
  const logs: string[] = [];
  const seq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: (s) => logs.push(s), models: [DatasetItem, Detection, User, Category, Product, ProductAllergen, Ingredient, Allergen, DetectionAllergen, FreeDetectionLog, FreeDetectionCounter, Content, Setting] } as any);
  await seq.sync({ force: true });
  await DatasetItem.create({ goldLabel: 'unsafe', correctedAllergens: [{ name: 'Gluten', presence: 'present' }] } as any);
  const found = await DatasetItem.findAll({ where: { correctedAllergens: { [Op.like]: '%Gluten%' } } as any });
  console.log(logs.join('\n'));
  console.log('found', found.length);
  expect(found.length).toBe(1);
  await seq.close();
});
