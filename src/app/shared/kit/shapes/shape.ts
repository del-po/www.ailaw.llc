import { Component, booleanAttribute, computed, input } from '@angular/core';
import { SHAPES, ShapeData, ShapeName } from './shapes';

@Component({
  selector: 'app-shape',
  templateUrl: './shape.html',
  styleUrl: './shape.scss',
  host: {
    '[style.aspect-ratio]': 'ratio()',
    '[class.is-front]': 'front()',
  },
})
export class Shape {
  readonly name = input.required<ShapeName>();

  // Draws the outline above the content instead of behind it (e.g. over a photo)
  readonly front = input(false, { transform: booleanAttribute });

  protected readonly shape = computed<ShapeData>(() => SHAPES[this.name()]);

  // Host keeps the shape's own proportions, so the drawing is never distorted
  protected readonly ratio = computed(() => {
    const [, , w, h] = this.shape().viewBox.split(' ');
    return `${w} / ${h}`;
  });
}
