-- Catálogo base de ejercicios para casa (el fisio los asigna al cerrar la sesión).
INSERT INTO exercises (code, name, dose, instructions) VALUES
  ('puente', 'Puente de glúteos', '3 series × 12', 'Boca arriba con las rodillas dobladas. Sube la cadera, aprieta los glúteos 2 segundos y baja despacio.'),
  ('pared', 'Sentadilla en la pared', '3 series × 10', 'Espalda apoyada en la pared. Baja hasta que las rodillas queden a 45° y sube.'),
  ('recta', 'Elevación de pierna recta', '3 series × 12', 'Boca arriba, una pierna doblada. Aprieta el muslo de la otra pierna y súbela hasta la altura de la rodilla doblada.'),
  ('toalla', 'Cuádriceps con toalla', '3 series × 10 (5 s)', 'Sentado con la pierna estirada y una toalla bajo la rodilla. Empuja la toalla hacia el piso 5 segundos.'),
  ('gato', 'Gato–camello', '2 series × 10', 'En cuatro apoyos, arquea la espalda hacia arriba y luego hacia abajo, despacio y sin dolor.'),
  ('hombro', 'Rotación externa con banda', '3 series × 15', 'Codo pegado al cuerpo a 90°. Abre el antebrazo hacia afuera contra la banda elástica.'),
  ('equilibrio', 'Equilibrio en un pie', '3 × 30 segundos', 'Cerca de una pared o silla. Mantén el equilibrio sobre la pierna afectada.'),
  ('respira', 'Respiración diafragmática', '5 minutos', 'Una mano en el pecho y otra en el abdomen. Inhala por la nariz inflando el abdomen y exhala lento por la boca.')
ON CONFLICT (code) DO NOTHING;
