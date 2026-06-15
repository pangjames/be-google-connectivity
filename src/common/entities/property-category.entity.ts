import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('ms_property_category')
export class PropertyCategory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  category_name: string;

  @Column('text')
  description: string;

  @Column()
  create_user: string;

  @Column()
  create_date: Date;

  @Column()
  update_user: string;

  @Column()
  update_date: Date;
}
