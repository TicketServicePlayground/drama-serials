import type { LegalSet } from "./legal";

export const LEGAL_ES: LegalSet = {
  updated: "Última actualización: 14 de noviembre de 2026",
  terms: {
    title: "Términos del servicio",
    short: "Términos",
    intro:
      "Estos Términos regulan el uso de AN Serials en {site}, un servicio de streaming de microdramas operado por {name}, {address} (\"nosotros\"). Al crear una cuenta o hacer una compra aceptas estos Términos, la Política de privacidad y la Política de reembolsos.",
    sections: [
      {
        heading: "1. Quién puede usar el servicio",
        paragraphs: [
          "Debes tener al menos 18 años, o contar con el consentimiento de tu madre, padre o tutor, para crear una cuenta y hacer compras.",
          "Eres responsable de mantener tu contraseña en secreto y de todo lo que se haga con tu cuenta. Avísanos en {email} si crees que alguien la ha usado sin tu permiso.",
        ],
      },
      {
        heading: "2. Cuenta",
        paragraphs: [
          "Te registras con un correo y una contraseña; no verificamos el correo. Usa una dirección que controles: con ella identificamos tus compras y respondemos a tus solicitudes.",
          "Una cuenta es para una persona. No puedes vender, compartir ni transferir el acceso.",
        ],
      },
      {
        heading: "3. Qué puedes comprar",
        paragraphs: [
          "Un episodio: acceso permanente a ese episodio mientras el servicio funcione y el episodio siga en el catálogo.",
          "Pases de 7 días, 30 días y 1 año: acceso a todos los episodios de todas las series durante 7, 30 o 365 días desde que se confirma el pago. Un pase comprado mientras otro está activo lo prolonga. Los pases no se renuevan automáticamente; no se cobra nada al terminar el periodo.",
          "Una serie por un día: todos los episodios de la serie elegida durante 24 horas desde que se confirma el pago. Los primeros episodios de cada serie son gratis; la página de la serie indica cuáles.",
          "Los pases VIP se venden a precio de lanzamiento hasta la fecha indicada junto a él; después de esa fecha se aplica el precio normal, que se muestra tachado.",
          "Las series VIP solo están disponibles con un pase VIP activo; sus episodios no se venden por separado. Puntos VIP: un miembro VIP recibe 50 puntos por cada día en que ve al menos un episodio, y 1.000 puntos se pueden canjear en el perfil por 1 día de VIP. Los puntos no tienen valor monetario, no se pueden transferir ni reembolsar, y las reglas pueden cambiar o terminar; los días VIP ya recibidos se mantienen.",
          "Los precios se muestran en rupias indonesias (IDR) e incluyen los impuestos que debemos cobrar. Pagas el precio que aparece en la página de pago en el momento de abrirla.",
        ],
      },
      {
        heading: "4. Oferta única",
        paragraphs: [
          "La primera vez que ves la pantalla de compra empieza para tu cuenta una oferta de bienvenida limitada: la mitad del precio normal durante el tiempo de la cuenta atrás (3 horas). Al terminar se aplican los precios normales. La oferta se da una vez por cuenta y no se puede reiniciar.",
        ],
      },
      {
        heading: "5. Pago",
        paragraphs: [
          "Los pagos los procesan proveedores de pago autorizados: QRIS a través de Xendit, tarjetas a través de DOKU y SBP (sistema de pagos rápidos de Rusia) a través de IXPAY. Sus páginas pueden mostrar el nombre comercial de nuestra empresa operadora. No recibimos ni guardamos el número de tu tarjeta ni tus datos bancarios.",
          "El acceso se abre en cuanto el proveedor confirma el pago, normalmente en segundos. Si el pago se confirma pero el acceso no se abre, escríbenos y lo resolveremos o te devolveremos el dinero.",
        ],
      },
      {
        heading: "6. Uso del contenido",
        paragraphs: [
          "Todas las series, episodios, imágenes y textos están protegidos por derechos de autor y se te licencian solo para verlos de forma personal y no comercial. No puedes copiarlos, descargarlos, grabarlos, volver a subirlos, emitirlos ni compartirlos, ni intentar saltarte los controles de acceso.",
          "El catálogo puede cambiar: se pueden añadir, editar o retirar series y episodios.",
        ],
      },
      {
        heading: "7. Suspensión",
        paragraphs: [
          "Podemos suspender o cerrar una cuenta que incumpla estos Términos, se use para fraude o comparta el acceso. Si cerramos una cuenta sin incumplimiento por tu parte, te devolvemos la parte no usada de un pase activo.",
        ],
      },
      {
        heading: "8. Responsabilidad",
        paragraphs: [
          "El servicio se ofrece según disponibilidad. Trabajamos para que funcione, pero no podemos garantizar que no tenga interrupciones. En la medida permitida por la ley, nuestra responsabilidad por cualquier reclamación relacionada con el servicio se limita a lo que nos pagaste en los 30 días anteriores. Nada en estos Términos limita tus derechos como consumidor según la ley de Indonesia.",
        ],
      },
      {
        heading: "9. Cambios y ley aplicable",
        paragraphs: [
          "Podemos actualizar estos Términos; la fecha de arriba indica la versión vigente. Los cambios se aplican a las compras posteriores a su publicación. Los cambios importantes se mostrarán en el sitio.",
          "Estos Términos se rigen por las leyes de la República de Indonesia. Las disputas se resuelven primero mediante negociación y, si no es posible, ante el tribunal competente de Yakarta, sin perjuicio de tus derechos como consumidor.",
          "Preguntas: {email}.",
        ],
      },
    ],
  },
  privacy: {
    title: "Política de privacidad",
    short: "Privacidad",
    intro:
      "Esta Política explica qué datos personales recoge AN Serials, para qué y cuáles son tus derechos. El responsable de tus datos es {name}, {address}. Tratamos los datos personales conforme a la Ley de Indonesia n.º 27 de 2022 de Protección de Datos Personales.",
    sections: [
      {
        heading: "1. Qué datos recogemos",
        paragraphs: [
          "Cuenta: tu correo y un hash irreversible de tu contraseña (nunca vemos ni guardamos la contraseña), y la fecha en que aceptaste estos documentos.",
          "Compras: qué compraste, el importe, el método de pago (QRIS o tarjeta), el estado y la hora, y las referencias del proveedor de pago. Los números de tarjeta y datos bancarios se introducen en la página del proveedor y nunca llegan a nosotros.",
          "Uso del servicio: el idioma elegido, tus «me gusta» y tu lista de series guardadas (en tu navegador), y los datos técnicos que registran nuestros servidores cuando nos visitas (dirección IP, tipo de navegador, hora de la solicitud). Nuestro propio contador de visitas no usa cookies y guarda un código que cambia cada día en lugar de tu dirección IP.",
        ],
      },
      {
        heading: "2. Para qué los usamos",
        paragraphs: [
          "Para crear y proteger tu cuenta y permitirte iniciar sesión (ejecución del contrato).",
          "Para cobrar, abrir el acceso y conservar el registro de compras (ejecución del contrato y obligaciones contables legales).",
          "Para prevenir fraude y abusos y mantener el servicio en funcionamiento (interés legítimo).",
          "No vendemos tus datos. A través del Píxel de Meta, Meta recibe eventos sobre tu visita para medir nuestros anuncios (ver la Política de cookies).",
        ],
      },
      {
        heading: "3. Quién los recibe",
        paragraphs: [
          "Proveedores de pago: Xendit (QRIS), DOKU (tarjetas) e IXPAY (SBP) reciben el importe, tu correo y la referencia del pedido.",
          "Infraestructura: nuestro proveedor de hosting (servidores) y Cloudflare (distribución de contenido) tratan datos en la medida necesaria para servir el sitio y los vídeos.",
          "Meta Platforms (Facebook, Instagram), a través del Píxel de Meta: los eventos descritos en la Política de cookies, para medir nuestros anuncios.",
          "Nuestro equipo recibe avisos internos de nuevos registros y pagos (correo, producto, importe) por un canal privado de Telegram, usado solo para atender a clientes y revisar pagos.",
          "Las autoridades, cuando la ley lo exija.",
        ],
      },
      {
        heading: "4. Cuánto tiempo los guardamos",
        paragraphs: [
          "Datos de la cuenta: mientras exista la cuenta. Si nos pides borrarla, los eliminamos en un plazo de 30 días.",
          "Registro de compras: el tiempo que exige la normativa fiscal y contable de Indonesia (hasta 10 años), incluso tras borrar la cuenta.",
          "Registros del servidor: hasta 90 días.",
        ],
      },
      {
        heading: "5. Tus derechos",
        paragraphs: [
          "Puedes pedirnos una copia de tus datos, corregirlos, borrar tu cuenta u oponerte a un tratamiento concreto, y retirar tu consentimiento en cualquier momento. Escribe a {email} desde el correo de tu cuenta; respondemos en un plazo de 3 × 24 horas, como exige la ley, y atendemos la solicitud lo antes posible.",
          "Si crees que tus datos se tratan de forma ilícita, también puedes reclamar ante la autoridad indonesia competente.",
        ],
      },
      {
        heading: "6. Seguridad y transferencias",
        paragraphs: [
          "Las conexiones van cifradas (HTTPS), las contraseñas se guardan solo como hash con sal y el acceso a la base de datos está restringido. Algunos proveedores tratan datos fuera de Indonesia; elegimos proveedores que los protegen con un nivel al menos equivalente al de la ley indonesia.",
        ],
      },
      {
        heading: "7. Menores",
        paragraphs: ["El servicio no está dirigido a menores de 18 años sin el consentimiento de su madre, padre o tutor."],
      },
      {
        heading: "8. Cambios",
        paragraphs: ["Publicaremos aquí cualquier cambio de esta Política, con una nueva fecha arriba. Contacto: {email}."],
      },
    ],
  },
  refunds: {
    title: "Política de reembolsos",
    short: "Reembolsos",
    intro:
      "Los episodios y pases son contenido digital que se entrega al instante. Al pagar pides que el acceso empiece de inmediato, por eso las compras son en general definitivas. Reembolsamos en los casos siguientes.",
    sections: [
      {
        heading: "1. Cuándo reembolsamos",
        paragraphs: [
          "Se te cobró dos veces la misma compra.",
          "El pago se confirmó pero el acceso no se abrió y no pudimos solucionarlo en 48 horas desde tu aviso.",
          "Un episodio que compraste no se podía reproducir por un problema técnico nuestro y no pudimos solucionarlo en 7 días desde tu aviso.",
          "Cerramos tu cuenta sin incumplimiento de los Términos por tu parte: devolvemos la parte no usada de un pase activo.",
        ],
      },
      {
        heading: "2. Cómo solicitarlo",
        paragraphs: [
          "Escribe a {email} en los 7 días siguientes al pago, desde el correo de tu cuenta, indicando fecha, importe y método de pago. Respondemos en 2 días hábiles.",
        ],
      },
      {
        heading: "3. Cómo se devuelve el dinero",
        paragraphs: [
          "Los reembolsos aprobados se hacen al mismo método de pago a través del proveedor que cobró (Xendit, DOKU o IXPAY), normalmente en 14 días hábiles; el plazo en que aparece el dinero depende de tu banco o monedero. Al reembolsar, termina el acceso comprado con ese pago.",
        ],
      },
      {
        heading: "4. Pases y cancelación",
        paragraphs: [
          "Los pases no se renuevan automáticamente, así que no hay nada que cancelar: el acceso termina a los 7, 30 o 365 días. Los días no usados no se reembolsan salvo en los casos anteriores.",
        ],
      },
    ],
  },
  cookies: {
    title: "Política de cookies",
    short: "Cookies",
    intro:
      "Las cookies son pequeños archivos que tu navegador guarda para un sitio web. AN Serials usa cookies propias y el Píxel de Meta, que mide su publicidad.",
    sections: [
      {
        heading: "1. Cookies necesarias (siempre activas)",
        paragraphs: [
          "ds_session: mantiene tu sesión iniciada (30 días).",
          "ds_consent: recuerda tu elección sobre cookies (1 año).",
          "El idioma forma parte de la dirección (?lang=), no es una cookie.",
        ],
      },
      {
        heading: "2. Cookies de preferencias (solo si las aceptas)",
        paragraphs: [
          "ds_favs: tus series guardadas (Mi lista), 1 año.",
          "ds_likes: los episodios y series que te gustan, 1 año.",
          "Si eliges «Solo necesarias», se guardan solo durante la visita y se pierden al cerrar la pestaña.",
        ],
      },
      {
        heading: "3. Píxel de Meta (publicidad)",
        paragraphs: [
          "Píxel de Meta (Meta Platforms): las cookies _fbp y _fbc, hasta 90 días. Nos indican qué anuncios en Facebook e Instagram traen visitas, registros y compras.",
          "El píxel envía a Meta las páginas que abres y estos eventos: ver una serie, registrarte, abrir un pago y una compra completada con su importe. No enviamos tu email ni tu contraseña.",
          "La elección del banner solo se aplica a nuestras cookies de preferencias (sección 2); el píxel funciona en cualquier caso.",
        ],
      },
      {
        heading: "4. Cambiar tu elección",
        paragraphs: [
          "Puedes borrar las cookies en la configuración del navegador cuando quieras; el aviso volverá a preguntarte. Preguntas: {email}.",
        ],
      },
    ],
  },
  contacts: {
    title: "Contacto",
    short: "Contacto",
    sections: [
      {
        heading: "Operador",
        paragraphs: ["{name}", "{address}"],
      },
      {
        heading: "Soporte, reembolsos y solicitudes sobre datos",
        paragraphs: ["{email}", "Respondemos en 2 días hábiles."],
      },
    ],
  },
};
