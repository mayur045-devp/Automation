import type { Schema, Struct } from '@strapi/strapi';

export interface ComponentAuthorData extends Struct.ComponentSchema {
  collectionName: 'components_component_author_data';
  info: {
    displayName: 'AuthorData';
  };
  attributes: {
    Authordesignation: Schema.Attribute.String;
    authorName: Schema.Attribute.String;
    image: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    title: Schema.Attribute.String;
  };
}

export interface ComponentButton extends Struct.ComponentSchema {
  collectionName: 'components_component_buttons';
  info: {
    displayName: 'button';
  };
  attributes: {
    link: Schema.Attribute.String;
    name: Schema.Attribute.String;
  };
}

export interface ComponentContentNew extends Struct.ComponentSchema {
  collectionName: 'components_component_content_news';
  info: {
    displayName: 'contentNew';
  };
  attributes: {
    content: Schema.Attribute.Blocks;
    title: Schema.Attribute.String;
  };
}

export interface ComponentOptions extends Struct.ComponentSchema {
  collectionName: 'components_component_options';
  info: {
    displayName: 'options';
  };
  attributes: {
    isCorrect: Schema.Attribute.Boolean;
    label: Schema.Attribute.String;
    votes: Schema.Attribute.Integer;
  };
}

export interface ComponentPolldata extends Struct.ComponentSchema {
  collectionName: 'components_component_polldata';
  info: {
    displayName: 'polldata';
  };
  attributes: {
    isActive: Schema.Attribute.Boolean;
    options: Schema.Attribute.Component<'component.options', false>;
    position: Schema.Attribute.Integer;
    subtitle: Schema.Attribute.String;
    title: Schema.Attribute.String;
  };
}

export interface ComponentQuizedata extends Struct.ComponentSchema {
  collectionName: 'components_component_quizedata';
  info: {
    displayName: 'Quizedata';
  };
  attributes: {
    isActive: Schema.Attribute.Boolean;
    options: Schema.Attribute.Component<'component.options', true>;
    position: Schema.Attribute.Integer;
    question: Schema.Attribute.String;
  };
}

export interface NameButton extends Struct.ComponentSchema {
  collectionName: 'components_name_buttons';
  info: {
    displayName: 'button';
  };
  attributes: {};
}

export interface SeoSeo extends Struct.ComponentSchema {
  collectionName: 'components_seo_seos';
  info: {
    displayName: 'seo';
  };
  attributes: {
    canonicalURL: Schema.Attribute.String;
    keywords: Schema.Attribute.Text;
    metaDescription: Schema.Attribute.String;
    metaImage: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    metaRobots: Schema.Attribute.String;
    metaSocial: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    metaTitle: Schema.Attribute.String;
    metaViewport: Schema.Attribute.String;
    structuredData: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'component.author-data': ComponentAuthorData;
      'component.button': ComponentButton;
      'component.content-new': ComponentContentNew;
      'component.options': ComponentOptions;
      'component.polldata': ComponentPolldata;
      'component.quizedata': ComponentQuizedata;
      'name.button': NameButton;
      'seo.seo': SeoSeo;
    }
  }
}
