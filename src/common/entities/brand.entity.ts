import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('ms_brand')
export class Brand {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  brand_name: string;

  @Column()
  logo_image: string;

  @Column({ nullable: true })
  sort_order: number;

  @Column()
  create_user: string;

  @Column()
  create_date: Date;

  @Column({ nullable: true })
  update_user: string;

  @Column()
  update_date: Date;
}
