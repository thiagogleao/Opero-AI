import type { LocalizationResource } from '@clerk/nextjs/types'

/**
 * Clerk's look and words for the partners' sign-in, passed to <ClerkProvider>
 * in app/layout.tsx.
 *
 * Appearance: colour values are literal hex because Clerk derives its own
 * shades from them (it cannot read our CSS variables); they are the tokens of
 * app/globals.css. Fonts are the CSS variables, which Clerk only passes through.
 * `options` is Clerk UI v1's name for what older versions called `layout`.
 *
 * Localization: @clerk/localizations is not installed, so every string a
 * partner can meet on the way in is written here — start, password, e-mail or
 * phone codes, the forgotten-password and reset steps, second factors, and the
 * errors those steps return. Sign-up is closed (the owner creates accounts), so
 * its screens are not translated and its links are emptied. `satisfies`
 * catches a mistyped key against Clerk's own type.
 */

export const clerkAppearance = {
  variables: {
    colorPrimary: '#e7ebef',            // --tx: the primary button is light on dark
    colorPrimaryForeground: '#08090c',  // --bg
    colorBackground: '#11151a',         // --card
    colorForeground: '#e7ebef',         // --tx
    colorMutedForeground: '#a7b1bc',    // --tx-2
    colorMuted: '#151a20',              // --card-2
    colorInput: '#0d1014',              // --panel
    colorInputForeground: '#e7ebef',
    // Clerk draws borders at 7–11% opacity of this colour: the light text
    // colour lands on --line / --line-2 over the card (#272e37 itself vanished).
    colorBorder: '#e7ebef',
    colorRing: '#7fb2ee',               // --info, the focus ring
    colorDanger: '#f2837a',             // --neg
    colorSuccess: '#4fcb98',            // --pos
    colorWarning: '#e5b65e',            // --warn
    colorNeutral: '#e7ebef',
    colorShadow: '#000000',
    colorModalBackdrop: 'rgba(8, 9, 12, .7)',
    fontFamily: 'var(--sans)',
    fontFamilyButtons: 'var(--sans)',
    borderRadius: '10px',               // --r-ctl
  },
  options: {
    // The "Development mode" badge is English and means nothing to a partner;
    // the browser console still warns when development keys are in use.
    unsafe_disableDevelopmentModeWarnings: true,
  },
  elements: {
    card: { border: '1px solid #1c2229', boxShadow: '0 30px 80px -20px rgba(0,0,0,.7)' },
    // The card footer only carries Clerk's "Secured by clerk" badge (English,
    // no localization key) and the sign-up link, which is closed: hidden. The
    // forms' own links ("Entrar de outro jeito") live inside the card.
    footer: { display: 'none' },
    headerTitle: { fontSize: '17px', fontWeight: 600, letterSpacing: '-.01em' },
    formFieldInput: { fontSize: '14px' },
  },
}

const strings = {
  locale: 'pt-BR',
  maintenanceMode: 'O acesso está em manutenção. Volte em alguns minutos.',

  socialButtonsBlockButton: 'Continuar com {{provider|titleize}}',
  socialButtonsBlockButtonManyInView: '{{provider|titleize}}',
  lastAuthenticationStrategy: 'Usado da última vez',
  dividerText: 'ou',

  formFieldLabel__emailAddress: 'E-mail',
  formFieldLabel__emailAddress_username: 'E-mail ou usuário',
  formFieldLabel__username: 'Usuário',
  formFieldLabel__phoneNumber: 'Telefone',
  formFieldLabel__password: 'Senha',
  formFieldLabel__currentPassword: 'Senha atual',
  formFieldLabel__newPassword: 'Nova senha',
  formFieldLabel__confirmPassword: 'Repita a nova senha',
  formFieldLabel__signOutOfOtherSessions: 'Sair de todos os outros aparelhos',
  formFieldLabel__backupCode: 'Código de backup',
  formFieldLabel__passkeyName: 'Nome da chave de acesso',
  formFieldInputPlaceholder__emailAddress: 'seu e-mail',
  formFieldInputPlaceholder__emailAddress_username: 'seu e-mail ou usuário',
  formFieldInputPlaceholder__username: 'seu usuário',
  formFieldInputPlaceholder__phoneNumber: 'seu telefone',
  formFieldInputPlaceholder__password: 'sua senha',
  formFieldInputPlaceholder__backupCode: 'código de backup',
  formFieldInput__emailAddress_format: 'Formato: nome@exemplo.com',
  formFieldError__notMatchingPasswords: 'As duas senhas não são iguais.',
  formFieldError__matchingPasswords: 'As duas senhas são iguais.',
  formFieldError__verificationLinkExpired: 'O link expirou. Peça um novo.',
  formFieldAction__forgotPassword: 'Esqueceu a senha?',
  formFieldHintText__optional: 'Opcional',
  formButtonPrimary: 'Continuar',
  formButtonPrimary__verify: 'Confirmar',
  signInEnterPasswordTitle: 'Digite sua senha',
  backButton: 'Voltar',
  footerActionLink__useAnotherMethod: 'Entrar de outro jeito',
  footerActionLink__alternativePhoneCodeProvider: 'Receber o código por SMS',
  footerPageLink__help: 'Ajuda',
  footerPageLink__privacy: 'Privacidade',
  footerPageLink__terms: 'Termos',

  signIn: {
    start: {
      title: 'Entrar no Opero',
      titleCombined: 'Entrar no Opero',
      subtitle: 'Acesso para sócios das lojas',
      subtitleCombined: 'Acesso para sócios das lojas',
      // Sign-up is closed: no "Não tem conta? Cadastre-se" line.
      actionText: '',
      actionLink: '',
      actionText__join_waitlist: '',
      actionLink__join_waitlist: '',
      actionLink__use_email: 'Usar e-mail',
      actionLink__use_phone: 'Usar telefone',
      actionLink__use_username: 'Usar usuário',
      actionLink__use_email_username: 'Usar e-mail ou usuário',
      actionLink__use_passkey: 'Usar chave de acesso',
      alternativePhoneCodeProvider: {
        actionLink: 'Usar outro método',
        label: 'Telefone do {{provider}}',
        subtitle: 'Digite seu telefone para receber o código pelo {{provider}}.',
        title: 'Entrar com {{provider}}',
      },
    },
    password: {
      title: 'Digite sua senha',
      subtitle: 'para continuar no Opero',
      actionLink: 'Entrar de outro jeito',
    },
    passwordPwned: {
      title: 'Essa senha apareceu num vazamento de dados. Crie uma nova.',
    },
    passwordCompromised: {
      title: 'Essa senha não é mais segura. Crie uma nova.',
    },
    passkey: {
      title: 'Use sua chave de acesso',
      subtitle: 'A chave confirma que é você — com o rosto, a digital ou o bloqueio de tela.',
    },
    forgotPasswordAlternativeMethods: {
      title: 'Esqueceu a senha?',
      label__alternativeMethods: 'Ou entre de outro jeito:',
      blockButton__resetPassword: 'Criar uma nova senha',
    },
    forgotPassword: {
      title: 'Criar uma nova senha',
      subtitle: 'para voltar a entrar no Opero',
      subtitle_email: 'Digite o código que enviamos para o seu e-mail',
      subtitle_phone: 'Digite o código que enviamos para o seu telefone',
      formTitle: 'Código para criar a senha',
      resendButton: 'Não recebeu? Enviar de novo',
    },
    resetPassword: {
      title: 'Crie a nova senha',
      formButtonPrimary: 'Salvar a nova senha',
      successMessage: 'Senha alterada. Entrando…',
      requiredMessage: 'Por segurança, crie uma nova senha para continuar.',
    },
    resetPasswordMfa: {
      detailsLabel: 'Antes de criar a nova senha, confirme que é você.',
    },
    emailCode: {
      title: 'Confira seu e-mail',
      subtitle: 'para continuar no Opero',
      formTitle: 'Código de verificação',
      resendButton: 'Não recebeu? Enviar de novo',
    },
    emailLink: {
      title: 'Confira seu e-mail',
      subtitle: 'para continuar no Opero',
      formTitle: 'Link de acesso',
      formSubtitle: 'Abra o link que enviamos para o seu e-mail',
      resendButton: 'Não recebeu? Enviar de novo',
      unusedTab: { title: 'Pode fechar esta aba' },
      verified: { title: 'Pronto, você entrou', subtitle: 'Voltando para o Opero…' },
      verifiedSwitchTab: {
        subtitle: 'Volte para a aba original para continuar',
        titleNewTab: 'Você entrou em outra aba',
        subtitleNewTab: 'Volte para a aba nova para continuar',
      },
      loading: { title: 'Entrando…', subtitle: 'Você vai para o Opero em instantes' },
      failed: { title: 'Este link não é válido', subtitle: 'Volte para a aba original para continuar.' },
      expired: { title: 'Este link expirou', subtitle: 'Volte para a aba original para continuar.' },
      clientMismatch: {
        title: 'Link aberto em outro aparelho',
        subtitle: 'Abra o link no mesmo navegador em que você pediu o acesso.',
      },
    },
    phoneCode: {
      title: 'Confira seu telefone',
      subtitle: 'para continuar no Opero',
      formTitle: 'Código de verificação',
      resendButton: 'Não recebeu? Enviar de novo',
    },
    alternativePhoneCodeProvider: {
      title: 'Confira o {{provider}}',
      subtitle: 'para continuar no Opero',
      formTitle: 'Código de verificação',
      resendButton: 'Não recebeu? Enviar de novo',
    },
    emailCodeMfa: {
      title: 'Confira seu e-mail',
      subtitle: 'Digite o código que enviamos para o seu e-mail',
      formTitle: 'Código de verificação',
      resendButton: 'Não recebeu? Enviar de novo',
    },
    emailLinkMfa: {
      title: 'Confira seu e-mail',
      subtitle: 'Abra o link que enviamos para o seu e-mail',
      formSubtitle: 'Use o link de verificação enviado para o seu e-mail',
      resendButton: 'Não recebeu? Enviar de novo',
    },
    newDeviceVerificationNotice: 'Você está entrando de um aparelho novo. Por segurança, confirme que é você.',
    phoneCodeMfa: {
      title: 'Confira seu telefone',
      subtitle: 'Digite o código que enviamos para o seu telefone',
      formTitle: 'Código de verificação',
      resendButton: 'Não recebeu? Enviar de novo',
    },
    totpMfa: {
      title: 'Verificação em duas etapas',
      subtitle: 'Digite o código do seu aplicativo autenticador',
      formTitle: 'Código de verificação',
    },
    backupCodeMfa: {
      title: 'Digite um código de backup',
      subtitle: 'Use um dos códigos que você guardou ao ativar a verificação em duas etapas',
    },
    alternativeMethods: {
      title: 'Outro jeito de entrar',
      subtitle: 'Problemas para entrar? Escolha outro método.',
      actionText: 'Nenhum deles serve?',
      actionLink: 'Pedir ajuda',
      blockButton__emailLink: 'Receber um link em {{identifier}}',
      blockButton__emailCode: 'Receber um código em {{identifier}}',
      blockButton__phoneCode: 'Receber um código por SMS em {{identifier}}',
      blockButton__password: 'Entrar com senha',
      blockButton__passkey: 'Usar chave de acesso',
      blockButton__totp: 'Usar o aplicativo autenticador',
      blockButton__backupCode: 'Usar um código de backup',
      getHelp: {
        title: 'Pedir ajuda',
        content: 'Se não consegue entrar, fale com o dono do Opero: ele cria e recupera as contas dos sócios.',
        blockButton__emailSupport: 'Escrever para o suporte',
      },
    },
    noAvailableMethods: {
      title: 'Não é possível entrar',
      subtitle: 'Ocorreu um erro',
      message: 'Esta conta não tem nenhum método de entrada ativo. Fale com o dono do Opero.',
    },
    accountSwitcher: {
      title: 'Escolha uma conta',
      subtitle: 'para continuar no Opero',
      action__addAccount: 'Entrar com outra conta',
      action__signOutAll: 'Sair de todas as contas',
    },
    enterpriseConnections: {
      title: 'Entrar com a conta da empresa',
      subtitle: 'Escolha a conta para continuar no Opero',
    },
  },

  unstable__errors: {
    form_identifier_not_found: 'Não há conta no Opero com esse e-mail. As contas de sócio são criadas pelo dono.',
    form_password_incorrect: 'Senha incorreta. Tente de novo ou entre de outro jeito.',
    form_password_or_identifier_incorrect: 'E-mail ou senha incorretos.',
    form_code_incorrect: 'Código incorreto.',
    form_param_nil: 'Preencha este campo.',
    form_param_format_invalid: 'Formato inválido.',
    form_param_format_invalid__email_address: 'Digite um e-mail válido.',
    form_param_type_invalid: 'Valor inválido.',
    form_param_type_invalid__email_address: 'Digite um e-mail válido.',
    form_param_type_invalid__phone_number: 'Digite um telefone válido.',
    form_param_value_invalid: 'Valor inválido.',
    form_param_max_length_exceeded: 'Texto longo demais.',
    form_email_address_blocked: 'Este e-mail não pode ser usado.',
    form_password_pwned: 'Essa senha apareceu num vazamento de dados. Escolha outra.',
    form_password_pwned__sign_in: 'Essa senha apareceu num vazamento de dados. Crie uma nova.',
    form_password_compromised__sign_in: 'Essa senha não é mais segura. Crie uma nova.',
    form_new_password_matches_current: 'A nova senha precisa ser diferente da atual.',
    form_password_length_too_short: 'Senha curta demais.',
    form_password_not_strong_enough: 'Senha fraca demais.',
    form_password_size_in_bytes_exceeded: 'Senha longa demais.',
    form_password_validation_failed: 'Senha incorreta.',
    not_allowed_access: 'Este e-mail não tem acesso ao Opero.',
    external_account_not_found: 'Essa conta não está ligada a nenhum sócio. Entre com o e-mail que o dono cadastrou.',
    session_exists: 'Você já entrou.',
    captcha_invalid: 'Não foi possível confirmar que você não é um robô. Recarregue a página e tente de novo.',
    captcha_unavailable: 'A verificação contra robôs não carregou. Recarregue a página e tente de novo.',
    passkey_not_supported: 'Este aparelho não aceita chave de acesso.',
    passkey_pa_not_supported: 'É preciso um autenticador da própria plataforma, que este aparelho não tem.',
    passkey_retrieval_cancelled: 'A chave de acesso foi cancelada ou expirou.',
    passwordComplexity: {
      sentencePrefix: 'A senha precisa ter',
      minimumLength: '{{length}} ou mais caracteres',
      maximumLength: 'menos de {{length}} caracteres',
      requireNumbers: 'um número',
      requireLowercase: 'uma letra minúscula',
      requireUppercase: 'uma letra maiúscula',
      requireSpecialCharacter: 'um caractere especial',
    },
    zxcvbn: {
      notEnough: 'Senha fraca demais.',
      couldBeStronger: 'A senha serve, mas poderia ser mais forte. Use mais caracteres.',
      goodPassword: 'Boa senha.',
      warnings: {
        straightRow: 'Teclas em sequência no teclado são fáceis de adivinhar.',
        keyPattern: 'Padrões curtos do teclado são fáceis de adivinhar.',
        simpleRepeat: 'Caracteres repetidos, como "aaa", são fáceis de adivinhar.',
        extendedRepeat: 'Grupos repetidos, como "abcabcabc", são fáceis de adivinhar.',
        sequences: 'Sequências comuns, como "abc", são fáceis de adivinhar.',
        recentYears: 'Anos recentes são fáceis de adivinhar.',
        dates: 'Datas são fáceis de adivinhar.',
        topTen: 'Esta senha é muito usada.',
        topHundred: 'Esta senha é usada com frequência.',
        common: 'Esta é uma senha comum.',
        similarToCommon: 'Parecida demais com uma senha comum.',
        wordByItself: 'Uma palavra sozinha é fácil de adivinhar.',
        namesByThemselves: 'Nomes ou sobrenomes sozinhos são fáceis de adivinhar.',
        commonNames: 'Nomes e sobrenomes comuns são fáceis de adivinhar.',
        userInputs: 'Não use dados pessoais nem do site.',
        pwned: 'Esta senha apareceu num vazamento de dados.',
      },
      suggestions: {
        l33t: 'Trocar letras por símbolos parecidos ("@" no lugar de "a") não ajuda.',
        reverseWords: 'Evite palavras comuns escritas de trás para frente.',
        allUppercase: 'Use maiúsculas em algumas letras, não em todas.',
        capitalization: 'Use maiúsculas em outras letras além da primeira.',
        dates: 'Evite datas ligadas a você.',
        recentYears: 'Evite anos recentes.',
        associatedYears: 'Evite anos ligados a você.',
        sequences: 'Evite sequências comuns de caracteres.',
        repeated: 'Evite palavras e caracteres repetidos.',
        longerKeyboardPattern: 'Use padrões de teclado mais longos e mude de direção várias vezes.',
        anotherWord: 'Acrescente palavras menos comuns.',
        useWords: 'Use várias palavras, sem frases conhecidas.',
        noNeed: 'Dá para criar senhas fortes sem símbolos, números ou maiúsculas.',
        pwned: 'Se usa esta senha em outro lugar, troque-a lá também.',
      },
    },
  },
} satisfies LocalizationResource

/**
 * Keys the Clerk UI loaded at runtime (@clerk/ui 1.42) reads but the installed
 * type does not list yet: the show/hide button inside the password field. They
 * are merged after the checked object, so `satisfies` still covers the rest.
 */
const runtimeOnly = {
  formFieldAction__showPassword: 'Mostrar senha',
  formFieldAction__hidePassword: 'Ocultar senha',
}

export const clerkLocalization: LocalizationResource = { ...strings, ...runtimeOnly }
